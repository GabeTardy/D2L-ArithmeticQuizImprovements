D2L := module()
description "Tools for importing and processing D2L quiz data";
option package;
export ImportAttemptData, ImportQuiz, ChangeUnits, NoUnits, SetQuizDir, PrettifiedQuiz, SimulateQuestion;

    # Options
    local QuizDir, CurrentQuizName, CurrentQuizData;
    QuizDir := "Quizzes/";
    CurrentQuizName := "";
    CurrentQuizData := table();

    # --- Option getter/setter utilities ---
    SetQuizDir := proc(dirPath::string)
        QuizDir := cat(dirPath, "/");
    end proc:

    # Import attempt data from a D2L quiz CSV file
    ImportAttemptData := proc(wsPath):
        local quizData, usernameColumn, attemptNumberColumn, questionNumberColumn, subquestionNumberColumn, questionTypeColumn, allUsers, numUsers, userAttempts, i, user, userAttemptsRowIndices, thisUserAttempts, lastAttempt, lastAttemptRowIndices, userAttemptsFormatted, userQuestions, questionStartingIndex, j;

        quizData := Import(wsPath,base=worksheetdir, output=Matrix):

        # CSV import options
        usernameColumn := 2:
        attemptNumberColumn := 5:
        questionNumberColumn := 8: # Used for the overarching question (usually section number)
        subquestionNumberColumn := 9:
        questionTypeColumn := 10:

        # Remove header row from data (useful to see but not useful for Maple)
        quizData := quizData[2..-1,..]:

        # Get all users who attempted the quiz and convert to ordered list.
        allUsers := [seq(convert(quizData[..,usernameColumn], set))]:
        numUsers := nops(allUsers):

        # Extract user attempt data to a vector (each vector entry is one user's final quiz attempt)
        userAttempts := Vector(numUsers):

        for i from 1 to numUsers do:
            # Get current user
            user := allUsers[i];

            # Find indices corresponding to this username and filter only by that user
            userAttemptsRowIndices := select[indices](row -> quizData[row,usernameColumn] = user, [seq(1 .. RowDimension(quizData))]):
            thisUserAttempts := quizData[userAttemptsRowIndices,..];

            # Find last attempt by this user (highest number in column attemptNumberColumn)
            lastAttempt := max(thisUserAttempts[..,attemptNumberColumn]);

            # Keep only rows with that last attempt number
            lastAttemptRowIndices := select[indices](row -> thisUserAttempts[row,attemptNumberColumn] = lastAttempt, [seq(1 .. RowDimension(thisUserAttempts))]);
            userAttempts[i] := thisUserAttempts[lastAttemptRowIndices,..];
        end do:

        userAttempts:

        # Now, further break each user attempt down into problems and individual steps
        userAttemptsFormatted := Vector(numUsers):
        for i from 1 to numUsers do:
            # Questions for each user (including subparts)
            userQuestions := [];

            questionStartingIndex := 2;
            for j from 1 to RowDimension(userAttempts[i])-1 do: # last element is ALWAYS a section, assuming I did everything right
                if userAttempts[i][j][questionNumberColumn] = "" and userAttempts[i][j+1][questionNumberColumn] <> "" then
                    # Move all of the previous question subparts (from the question starting index to the current index, which are all subparts) into the user questions as a new question
                    userQuestions := [seq(userQuestions), userAttempts[i][questionStartingIndex..j,..]];

                    questionStartingIndex := j + 3; # New question starts after this row (j+1), after the summary (+1), after the header for the next question (+1)
                fi;
            end do;

            # Replace this user's attempt with the separated question subpart list, organized per question.
            userAttemptsFormatted[i] := userQuestions;
        end do:

        return userAttemptsFormatted;
    end proc:

    # Import quiz data from instructor-generated JSON quiz file
    ImportQuiz := proc(quizName):
        CurrentQuizName := quizName:
        CurrentQuizData := JSON:-ParseFile(cat(QuizDir, CurrentQuizName, ".json"), output=table);
        return copy(CurrentQuizData, 'deep');
    end proc:

    # Show a prettified version of the current quiz data; see https://www.mapleprimes.com/questions/212273-How-To-Read-A-JSON-File
    PrettifiedQuiz := proc():
        return (T-> subsindets(subsindets(`<,>`(op(T)), table, thisproc), list, `<,>`))(CurrentQuizData);
    end proc:

    # --- Utilities for quiz administration ---
    SimulateQuestion := proc(id::integer):
        error "Not implemented yet";
    end proc:

    # --- Utilities for question processing ---
    # Shorthand for unit conversion
    ChangeUnits := proc(exprWithUnits, newUnits):
        return convert(exprWithUnits, 'units', newUnits);
    end proc:

    # Shorthand for unit stripping
    NoUnits := proc(exprWithUnits):
        return convert(exprWithUnits, 'unit_free');
    end proc:
end module: