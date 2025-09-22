// imports here
import * as readline from "node:readline";
import * as crypto from "node:crypto";

// Types here
export type BSQuestionOptions = {
  muteAnswer?: boolean;
  muteChar?: string;
};

export type EncryptedSecret = {
  isBuffer: boolean;
  iv: string;
  authTag: string;
  cipherText: string;
};

// Consts here
const SECRET_IV_SIZE = 12;
const SECRET_KEY_SIZE = 32;
const SECRET_ALGO = "aes-256-gcm";

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

export const encryptSecret = (
  secret: string | Buffer,
  key: string | Buffer,
  outputEncoding: crypto.Encoding = "base64", // used for strings and Buffers
  inputEncoding: crypto.Encoding = "utf-8", // only used for strings
): EncryptedSecret | null => {
  // Make sure the key len is 32 - this is a requirement
  if (key.length !== SECRET_KEY_SIZE) {
    return null;
  }

  // Check if the secret is a buffer or string
  const isBuffer = Buffer.isBuffer(secret);

  // Create a random IV
  const iv = crypto.randomBytes(SECRET_IV_SIZE);

  // Create a new cipher object
  const cipher = crypto.createCipheriv(SECRET_ALGO, key, iv);

  // Encrypt the secret - check if it is a string or Buffer
  let cipherText = isBuffer
    ? cipher.update(secret, undefined, outputEncoding) // No inputEncoding for Buffers
    : cipher.update(secret, inputEncoding, outputEncoding);

  cipherText += cipher.final(outputEncoding);

  // Generate the authentication tag
  const tag = cipher.getAuthTag();

  const encrypted: EncryptedSecret = {
    isBuffer,
    iv: iv.toString(outputEncoding), // convert the Buffer to string
    authTag: tag.toString(outputEncoding), // convert the Buffer to string
    cipherText,
  };

  return encrypted;
};

export const decryptSecret = (
  secret: EncryptedSecret,
  key: string | Buffer,
  inputEncoding: crypto.Encoding = "base64", // outputEncoding from encryptSecret
  outputEncoding: crypto.Encoding = "utf-8", // only used for strings
): string | Buffer | null => {
  // Make sure the key len is 32 - this is a requirement
  if (key.length !== SECRET_KEY_SIZE) {
    return null;
  }

  // Create a decipher object
  const iv = Buffer.from(secret.iv, inputEncoding);
  const decipher = crypto.createDecipheriv(SECRET_ALGO, key, iv);

  // Set the  authentication tag
  const tag = Buffer.from(secret.authTag, inputEncoding);
  decipher.setAuthTag(tag);

  let decrypted: string | Buffer | null = null;

  // Decrypt the secret
  try {
    // Check if the secret is a Buffer or a string
    if (secret.isBuffer) {
      decrypted = Buffer.concat([
        decipher.update(secret.cipherText, inputEncoding), // no outputEncoding for Buffers
        decipher.final(), // no outputEncoding for Buffers
      ]);
    } else {
      decrypted =
        decipher.update(secret.cipherText, inputEncoding, outputEncoding) +
        decipher.final(outputEncoding);
    }
  } catch (_) {}

  return decrypted;
};
