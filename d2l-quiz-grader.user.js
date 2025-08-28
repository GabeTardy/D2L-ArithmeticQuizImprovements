// ==UserScript==
// @name         D2L Quiz Grader (Partial Credit Utility)
// @namespace    http://gabetardy.github.io/Misc/
// @version      0.0.2a
// @description  This portion of the script provides a utility which caches shadow DOM elements (of which D2L is rife) and then allows you to input a grade via code. In the future, it will load grades from a CSV file and apply them automatically.
// @author       Gabriel Tardy
// @match        https://*/d2l/le/activities/evaluation/actor/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=d2l.com
// @grant        none
// ==/UserScript==
(function() {

    // The SelectorCache class was written by ChatGPT-4o.
    (function() {
        class SelectorCache {
            constructor() {
                this.cache = new Map();
                this.ordered = []; // keep elements in DOM order
            }
    
            _getLocalSelector(el) {
                if (el.id) return `#${el.id}`;
                let sel = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') {
                    let classes = el.className.trim().split(/\s+/).join('.');
                    if (classes) sel += `.${classes}`;
                }
                if (el.parentNode && el.parentNode.querySelectorAll) {
                    let siblings = Array.from(el.parentNode.children).filter(e => e.tagName === el.tagName);
                    if (siblings.length > 1) {
                        let index = siblings.indexOf(el) + 1;
                        sel += `:nth-of-type(${index})`;
                    }
                }
                return sel;
            }
    
            _getComposedSelector(el) {
                let path = [];
                let current = el;
                while (current) {
                    // Gabe's note: I had to modify the following few lines as the AI failed to account for ShadowRoot being nodeType 11.
                    if (current.nodeType !== 1 && current.nodeType !== 11) break;
                    
                    if (current.parentNode) {
                        var local = this._getLocalSelector(current);
                        path.unshift(local);
                        current = current.parentNode;
                    } else if (current.host) {
                        path.unshift('::shadow');
                        current = current.host;
                    } else {
                        break;
                    }
                }
                return path.join(' > ');
            }
    
            _traverse(root, startingIndex = 0) {
                let nodes = root.querySelectorAll('*');

                // Gabe: Track index for a future optimization: if this object is known, then the position in the ordered list can be immediately accessed since this property is immutable in the cache unless the entire cache is rebuilt, in which case the index is reset anyway.
                let ownIndex = startingIndex;
                nodes.forEach(el => {
                    let selector = this._getComposedSelector(el);
                    let rect = el.getBoundingClientRect();
                    let entry = {
                        selector,
                        element: el,
                        rect: {
                            top: rect.top,
                            left: rect.left,
                            width: rect.width,
                            height: rect.height
                        },
                        index: ownIndex
                    };
                    this.cache.set(selector, entry);
                    this.ordered.push(entry);
    
                    if (el.shadowRoot) {
                        // Gabe: start the index from this current index + 1, then set the index in the host traversal to the return of the child traversal to preserve ordering.
                        ownIndex = this._traverse(el.shadowRoot, ownIndex + 1);
                    } else {
                        // Gabe: Increment own index
                        ownIndex++;
                    }
                });

                // Gabe: Return own index so that recursive calls to this function can continue indexing based on the global index.
                return ownIndex;
            }
    
            buildCache() {
                this.cache.clear();
                this.ordered = [];
                this._traverse(document);
            }
    
            get(selector) {
                return this.cache.get(selector)?.element || null;
            }
    
            getAll() {
                return Array.from(this.cache.entries());
            }
    
            query(selector) {
                let parts = selector.split(/\s*>\s*/);
                let currentRoot = document;
                let el = null;
    
                for (let part of parts) {
                    if (part === '::shadow') {
                        if (el && el.shadowRoot) {
                            currentRoot = el.shadowRoot;
                        } else {
                            return null;
                        }
                    } else {
                        el = currentRoot.querySelector(part);
                        if (!el) return null;
                    }
                }
                return el;
            }
    
            // --- Helpers ---
            findByTag(tagName) {
                let tag = tagName.toLowerCase();
                return this.ordered.filter(e => e.element.tagName.toLowerCase() === tag);
            }
    
            findByClass(className) {
                let cls = className.toLowerCase();
                return this.ordered.filter(e => e.element.classList && e.element.classList.contains(cls));
            }
    
            findById(id) {
                return this.ordered.filter(e => e.element.id === id);
            }
    
            findChildrenByTag(parent, childTag) {
                let results = [];
                for (let entry of this.ordered) {
                    if (
                        entry.element.tagName.toLowerCase() === childTag.toLowerCase() &&
                        entry.selector.includes(parent.selector)
                    ) {
                        results.push(entry);
                    }
                }
                return results;
            }

            findFollowingTagByName(tagA, tagB) {
                let results = [];
                let tagALower = tagA.toLowerCase();
                let tagBLower = tagB.toLowerCase();
    
                // Track if we've seen tagA yet
                let seenA = false;
                for (let entry of this.ordered) {
                    if (entry.element.tagName.toLowerCase() === tagALower) {
                        seenA = true;
                    } else if (seenA && entry.element.tagName.toLowerCase() === tagBLower) {
                        results.push(entry);
                    }
                }
                return results;
            }

            findFollowingTag(tagObject, tagB) {
                // Input Validation
                if (!tagObject || !tagObject.selector) return [];

                let tagBLower = tagB.toLowerCase();
                let results = [];
            
                // Find index of parentEntry in ordered list
                let idx = this.ordered.findIndex(e => e.selector === tagObject.selector);
                if (idx === -1) return results; // not found
            
                // Collect all tagB elements after that index
                for (let i = idx + 1; i < this.ordered.length; i++) {
                    let entry = this.ordered[i];
                    if (entry.element.tagName.toLowerCase() === tagBLower) {
                        results.push(entry);
                    }
                }
                return results;
            }
        }
    
        window.SelectorCache = SelectorCache;
    })();
    
    // Create a new selector cache in the global scope
    window.SD = new SelectorCache();
    SD.buildCache();

    // END (PRIMARILY) AI-GENERATED CODE
    // BEGIN CODE BY GABE TARDY
    class TardyGrader {

        // It is easier to mimic input this way than to spoof the PATCH request that D2L sends when you manually enter a grade. I couldn't figure out what it requires and I did not want to risk being ratelimited seeing as I have a course to administer :)
        constructor() {
            this.problems = SD.findByTag("d2l-consistent-evaluation-quizzing-section");
        }

        // Get current evaluated student's name. Assumes two-name names (First Last), returning ["First", "Last"]. If no name found, returns ["Unknown", "Student"].
        getCurrentStudentName() {
            return SD.findByClass("d2l-consistent-evaluation-lcb-user-name")[0]?.element.title.split(" ") || ["Unknown", "Student"];
        }

        // Return a specific problem header by section.
        // There are two d2l-consistent-evaluation-quizzing-section elements per problem, so we multiply the problem number by 2 and subtract 1 to get the correct index (the starting section in the grading view).
        getProblem(num) {
            // Rebuild cache if no problem headers cached
            if (this.problems.length === 0) {
                console.warn("No problems found on this page. Rebuilding cache...");
                SD.buildCache();
                this.problems = SD.findByTag("d2l-consistent-evaluation-quizzing-section");
    
                if (this.problems.length === 0) {
                    console.error("Still no problems found after rebuilding cache. Exiting.");
                    return null;
                }
            }
    
            if (this.problems.length < (num*2)) {
                console.error("Requested problem number exceeds available problems."); 
                return null; 
            }
    
            return this.problems[(num-1)*2];
        }

        // This returns an array of problem steps starting from the given problem and extending INTO OTHER PROBLEMS. Only access the steps that are known to belong to the current problem.
        // @TODO Future optimization: cache the steps in the TardyGrader object.
        getSteps(problem) {
            return SD.findFollowingTag(problem, "d2l-consistent-evaluation-quizzing-attempt-result");
        }

        // this would be a good place to add validation to make sure that the number of steps doesn't overflow into other problems.
        getStep(steps, num) {
            return steps[num-1]
        }

        getGradeByStep(step) {
            // If the step is the header for each "question", the first input is the grade input, and the second input is the feedback.
            var inputObject = SD.findChildrenByTag(step, "input")[0];
    
            if (!inputObject) {
                console.error("No grade input found for step:", step);
                return;
            }
    
            return inputObject.element.value; 
        }

        setGradeByStep(step, gradeFloat) {
            // If the step is the header for each "question", the first input is the grade input, and the second input is the feedback.
            var inputObject = SD.findChildrenByTag(step, "input")[0];
    
            if (!inputObject) {
                console.error("No grade input found for step:", step);
                return;
            }
    
            var input = inputObject.element;
            var newValue = gradeFloat;
    
            input.focus();
    
            // Step 2: Clear current value
            input.value = '';
    
            // Step 3: Set new value
            input.value = newValue;
    
            // Step 4: Dispatch events that trigger frameworks
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
    
            // Step 5: Blur to simulate clicking off
            input.blur();
        }

        // Example: TGrader.setGrade(2,1,2);
        getGrade(problemNum, stepNum) {
            var problem = this.getProblem(problemNum);
            if (!problem) {
                console.error("Problem not found:", problemNum);
                return;
            }
    
            var steps = this.getSteps(problem);
            if (steps.length < stepNum) {
                console.error("Requested step number exceeds remaining total steps.");
                return;
            }
    
            var step = this.getStep(steps, stepNum);
            if (!step) {
                console.error("Step ", stepNum, " not found.");
                return;
            }
            this.getGradeByStep(step);
        }

        // Example: TGrader.setGrade(2,1,2);
        setGrade(problemNum, stepNum, gradeFloat) {
            var problem = this.getProblem(problemNum);
            if (!problem) {
                console.error("Problem not found:", problemNum);
                return;
            }
    
            var steps = this.getSteps(problem);
            if (steps.length < stepNum) {
                console.error("Requested step number exceeds remaining total steps.");
                return;
            }
    
            var step = this.getStep(steps, stepNum);
            if (!step) {
                console.error("Step ", stepNum, " not found.");
                return;
            }
            this.setGradeByStep(step, gradeFloat);
        }

        getGrades() {
            var currentProblemNum = 1;
            var currentProblem = this.getProblem(currentProblemNum);
            var nextProblem = this.getProblem(currentProblemNum+1) || {index: Infinity};
            var currentProblemStepNumberOffset = 0;
            // Get steps for the first problem (i.e. every step in the entire quiz)
            var steps = this.getSteps(currentProblem);
            var grades = [[]]; // initialize with one empty array for the first problem

            console.log(`--- Problem 1 ---`);
            // step numbering is 1-indexed
            for (let globalStepNumber = 1; globalStepNumber <= steps.length; globalStepNumber++) {
                var step = this.getStep(steps, globalStepNumber);
                if (!step) {
                    console.error("Step ", globalStepNumber, " not found.");
                    return;
                }
    
                // if we're beyond the current problem's dom index, we must be in the next problem
                if (step.index > nextProblem.index && nextProblem.index !== Infinity) {
                    currentProblemNum++;
                    currentProblem = nextProblem;
                    nextProblem = currentProblemNum+1 <= this.problems.length/2 ? this.getProblem(currentProblemNum+1) : {index: Infinity};
                    currentProblemStepNumberOffset = globalStepNumber - 1;
                    console.log(`--- Problem ${currentProblemNum} ---`);

                    // make sure new problem has a grades array
                    grades.push([]);
                }

                var grade = +this.getGradeByStep(step); // noticed that this was not a number for some reason so force it to be a number because I want it to be
                console.log(`Problem ${currentProblemNum}, Step ${globalStepNumber - currentProblemStepNumberOffset}: Grade = ${grade}`);

                // actually add to the grades array
                grades[currentProblemNum-1].push(grade)
            }

            return grades;
        }

        // The fact that future problems' substeps are included in each problem's step list has transcended being a bug and is now a feature.
        // This allows us to completely flatten the grades into grades for each step and assign them all in one go.
        setGrades(gradeArray){
            var gradesFlattened = gradeArray.flat();
            for(var i = 0; i < gradesFlattened.length; i++){
                var grade = gradesFlattened[i];

                // Skip grades listed as -1 (indicating no change)
                if(grade > 0){
                    this.setGrade(1, i+1, grade);
                }
            }
        }
    }

    // Expose the grading service to the global scope (primarily for debugging)
    window.TGrader = new TardyGrader();

    console.log("D2L Auto Partial Credit grader loaded.");
})();