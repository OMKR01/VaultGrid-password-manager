#!/usr/bin/env node
/**
 * Emergency recovery tool.
 *
 * Decrypts a vault.json file (the live one, or any backup copy of it)
 * directly from the command line — no need to run the server or app.
 * You still need your master password; nothing about this bypasses
 * encryption, it just performs the same decryption server.js does.
 *
 * Usage:
 *   node recover.js
 *   node recover.js "C:\path\to\a\backup\vault.json"
 *   node recover.js --csv                      (also writes recovered.csv)
 *   node recover.js "C:\backup\vault.json" --csv
 *
 * Run this from inside the project folder (it needs node_modules/bcryptjs,
 * which a plain `npm install` already provides — you do NOT need to have
 * built or run the Electron app for this to work).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
const writeCsv = args.includes('--csv');
const vaultPathArg = args.find(a => !a.startsWith('--'));
const vaultPath = vaultPathArg || path.join(__dirname, 'data', 'vault.json');

// Minimal masked password prompt (shows nothing as you type) using only
// Node's built-ins, so there is no extra dependency for something this small.
function readMaskedPassword(promptText) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let input = '';
    process.stdout.write(promptText);
    const canMask = stdin.isTTY && typeof stdin.setRawMode === 'function';
    if (canMask) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Process character-by-character rather than treating a whole incoming
    // chunk as one character — input can arrive as a multi-character chunk
    // (always when piped, and often even from a fast typist or paste).
    const onData = (chunk) => {
      const str = chunk.toString();
      for (const ch of str) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          if (canMask) stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (ch === '\u0003') { // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
        } else if (ch === '\u007f' || ch === '\b') { // backspace
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

function deriveKey(masterPassword, keySaltHex) {
  return crypto.scryptSync(masterPassword, Buffer.from(keySaltHex, 'hex'), 32);
}

function decrypt(enc, ivHex, tagHex, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function main() {
  if (!fs.existsSync(vaultPath)) {
    console.error(`Could not find a vault file at:\n  ${vaultPath}\n`);
    console.error('Pass the full path to the backup file as an argument, e.g.:');
    console.error('  node recover.js "C:\\Users\\you\\Backups\\vault.json"');
    process.exit(1);
  }

  let vault;
  try {
    vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  } catch (e) {
    console.error('That file is not valid JSON — it may be corrupted.');
    process.exit(1);
  }
  if (!vault.masterHash || !vault.keySalt) {
    console.error('That file does not look like a VaultGrid vault.json (missing masterHash/keySalt).');
    process.exit(1);
  }
  if (!Array.isArray(vault.entries) || vault.entries.length === 0) {
    console.log('This vault has no saved entries.');
    return;
  }

  const masterPassword = await readMaskedPassword('Master password: ');

  if (!bcrypt.compareSync(masterPassword, vault.masterHash)) {
    console.error('\nIncorrect master password.');
    process.exit(1);
  }

  const keyHex = deriveKey(masterPassword, vault.keySalt).toString('hex');
  const rows = [];

  console.log(`\nDecrypted ${vault.entries.length} entr${vault.entries.length === 1 ? 'y' : 'ies'} from:\n  ${vaultPath}\n`);

  for (const entry of vault.entries) {
    let plain;
    try {
      plain = decrypt(entry.enc, entry.iv, entry.tag, keyHex);
    } catch (e) {
      plain = '[COULD NOT DECRYPT — this entry may be corrupted]';
    }
    console.log(`Site:     ${entry.site}`);
    console.log(`Username: ${entry.username || '(none)'}`);
    console.log(`Password: ${plain}`);
    console.log(`Category: ${entry.category || 'Other'}`);
    if (entry.notes) console.log(`Notes:    ${entry.notes}`);
    console.log('----------------------------------------');
    rows.push({
      site: entry.site,
      username: entry.username || '',
      password: plain,
      category: entry.category || '',
      notes: entry.notes || ''
    });
  }

  if (writeCsv) {
    const csvPath = path.join(path.dirname(vaultPath), 'recovered.csv');
    const header = 'site,username,password,category,notes';
    const lines = rows.map(r =>
      [r.site, r.username, r.password, r.category, r.notes].map(csvEscape).join(',')
    );
    fs.writeFileSync(csvPath, [header, ...lines].join('\n'));
    console.log(`\nAlso wrote a PLAINTEXT CSV to:\n  ${csvPath}`);
    console.log('This file is NOT encrypted. Import it wherever you need it, then delete it.');
  }
}

main();
