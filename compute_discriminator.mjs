import { createHash } from 'crypto';

function anchorDiscriminator(name) {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return Array.from(hash.slice(0, 8));
}

console.log('refund discriminator:', anchorDiscriminator('refund'));
console.log('claim discriminator:', anchorDiscriminator('claim'));
console.log('lock discriminator:', anchorDiscriminator('lock'));
console.log('initialize discriminator:', anchorDiscriminator('initialize'));
