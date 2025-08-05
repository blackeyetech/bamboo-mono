// imports here
import * as readline from "node:readline";

// Types here
export type BSQuestionOptions = {
  muteAnswer?: boolean;
  muteChar?: string;
};

export const sleep = async (durationInSeconds: number): Promise<void> => {
  // Convert duration to ms
  let ms = Math.round(durationInSeconds * 1000);

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const question = async (
  ask: string,
  questionOptions?: BSQuestionOptions,
): Promise<string> => {
  let input = process.stdin;
  let output = process.stdout;

  let options = {
    muteAnswer: false,
    muteChar: "*",

    ...questionOptions,
  };
  return new Promise((resolve) => {
    let rl = readline.createInterface({
      input,
      output,
    });

    if (options.muteAnswer) {
      input.on("keypress", () => {
        // get the number of characters entered so far:
        var len = rl.line.length;

        if (options.muteChar.length === 0) {
          // move cursor back one since we will always be at the start
          readline.moveCursor(output, -1, 0);
          // clear everything to the right of the cursor
          readline.clearLine(output, 1);
        } else {
          // move cursor back to the beginning of the input
          readline.moveCursor(output, -len, 0);
          // clear everything to the right of the cursor
          readline.clearLine(output, 1);

          // If there is a muteChar then replace the original input with it
          for (var i = 0; i < len; i++) {
            // In case the user passes a string just use the 1st char
            output.write(options.muteChar[0]);
          }
        }
      });
    }

    // Insert a space after the question for convience
    rl.question(`${ask} `, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
};
