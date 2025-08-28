// ==UserScript==
// @name         D2L Quiz Grader (Partial Credit Utility)
// @namespace    http://gabetardy.github.io/Misc/
// @version      0.0.1a
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
    
            _traverse(root) {
                let nodes = root.querySelectorAll('*');
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
                        }
                    };
                    this.cache.set(selector, entry);
                    this.ordered.push(entry);
    
                    if (el.shadowRoot) {
                        this._traverse(el.shadowRoot);
                    }
                });
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
    }

    // Expose the grading service to the global scope (primarily for debugging)
    window.TGrader = new TardyGrader();

    console.log("D2L Auto Partial Credit grader loaded.");
})();