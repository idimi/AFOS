import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { writeFileSync } from 'fs';

const phantom = new PhantomWalletAdapter();
const solflare = new SolflareWalletAdapter();

// Extract base64 data
const phantomB64 = phantom.icon.replace('data:image/svg+xml;base64,', '');
const solflareB64 = solflare.icon.replace('data:image/svg+xml;base64,', '');

const phantomSvg = Buffer.from(phantomB64, 'base64').toString('utf8');
const solflareSvg = Buffer.from(solflareB64, 'base64').toString('utf8');

writeFileSync('/home/ubuntu/webdev-static-assets/phantom-logo.svg', phantomSvg);
writeFileSync('/home/ubuntu/webdev-static-assets/solflare-logo.svg', solflareSvg);

console.log('Phantom SVG length:', phantomSvg.length);
console.log('Solflare SVG length:', solflareSvg.length);
console.log('Phantom icon data URL:', phantom.icon.substring(0, 80));
console.log('Solflare icon data URL:', solflare.icon.substring(0, 80));

// Also output the full data URLs for use in code
console.log('\n--- PHANTOM DATA URL ---');
console.log(phantom.icon);
console.log('\n--- SOLFLARE DATA URL ---');
console.log(solflare.icon);
