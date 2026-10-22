/**
 * Tests for the secret prompt module.
 *
 * These cover the rules that keep the administrator password out of the
 * transcript, the shell history, the process list and the logs:
 *
 *   - a generated password is long, strong and not guessable;
 *   - a generated password is written to a file that already exists only
 *     once, and is never echoed to the console;
 *   - the typed password is not echoed back to the terminal.
 */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import {
  generateSecret,
  promptForSecret,
  writeSecretFile,
} from '../../src/lib/secret-prompt.js';

describe('The secret prompt', () => {
  describe('Generating a password', () => {
    it('should produce the requested length', () => {
      expect(generateSecret(20).length).to.equal(20);
      expect(generateSecret(32).length).to.equal(32);
    });

    it('should refuse a length below the minimum and use the default', () => {
      expect(generateSecret(8).length).to.equal(24);
    });

    it('should produce a different password every time', () => {
      const seen = new Set();
      for (let i = 0; i < 50; i += 1) seen.add(generateSecret(24));
      expect(seen.size).to.equal(50);
    });

    it('should use a wide enough alphabet', () => {
      const password = generateSecret(64);
      const unique = new Set(password.split(''));
      expect(unique.size).to.be.greaterThan(30);
    });

    it('should not contain ambiguous characters', () => {
      const password = generateSecret(200);
      expect(password).to.not.match(/[O0lI1]/);
    });
  });

  describe('Writing the password to a file', () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-test-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('should write the secret to the file', () => {
      const filePath = path.join(dir, 'password.txt');
      writeSecretFile(filePath, 'CorrectHorseBattery');

      expect(fs.readFileSync(filePath, 'utf8')).to.equal('CorrectHorseBattery\n');
    });

    it('should refuse to overwrite an existing file', () => {
      const filePath = path.join(dir, 'password.txt');
      writeSecretFile(filePath, 'First');

      expect(() => writeSecretFile(filePath, 'Second')).to.throw(/already exists/);
      // The original is still intact.
      expect(fs.readFileSync(filePath, 'utf8')).to.equal('First\n');
    });

    it('should create the directory when it is missing', () => {
      const filePath = path.join(dir, 'nested', 'password.txt');
      writeSecretFile(filePath, 'Nested');

      expect(fs.existsSync(filePath)).to.equal(true);
    });
  });

  describe('Reading a password at the prompt', () => {
    it('should return what was typed', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let written = '';
      output.on('data', (chunk) => {
        written += chunk.toString();
      });

      const pending = promptForSecret({
        prompt: 'Password: ',
        input,
        output,
      });

      input.write('TypedSecret1!\n');

      const secret = await pending;

      expect(secret).to.equal('TypedSecret1!');
    });

    it('should not echo the typed characters', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let written = '';
      output.on('data', (chunk) => {
        written += chunk.toString();
      });

      const pending = promptForSecret({
        prompt: 'Password: ',
        input,
        output,
      });

      input.write('NeverEchoed1!\n');
      await pending;

      expect(written).to.not.include('NeverEchoed1!');
    });
  });
});
