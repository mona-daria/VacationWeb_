import { hashPassword } from '../server/domain.mjs';

const password = process.argv[2] || '';
if (!password) {
  console.error('Usage: node tools/make-hash.mjs "YourPassword"');
  process.exit(1);
}
console.log(hashPassword(password));
