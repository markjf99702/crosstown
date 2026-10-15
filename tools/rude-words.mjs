// Words nobody wants to be told they found. tools/make-puzzles.mjs leaves them out of the detours, and the tests
// check every board again. Erring wide is fine: a word left out here just doesn't earn fare.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const listed = new Set(require('naughty-words').en.map(w => w.toLowerCase()));
// That list misses plurals and a few slurs, so these catch the rest.
const RUDE = new RegExp([
  'fuck', 'shit', 'piss', 'cunt', 'penis', 'vagina', 'slut', 'whore', 'bitch', 'wank', 'twat', 'dildo', 'semen', 'jizz',
  'porn', 'nazi', 'nigger', 'nigga', 'faggot', 'redskin', 'darkie', 'darky', 'sambo', 'honky', 'honkie', 'tranny',
  'mongoloid', 'lesbo', 'skank', 'molest', 'incest', 'pedophil', 'paedophil', 'gypsy', 'gypsies', 'cocksuck',
  '^cocks?$', '^dick(s|ed|head.*)?$', '^puss(y|ies)$', '^anus(es)?$', '^anal$', '^rap(e|ed|es|er|ers|ing|ist|ists)$',
  '^tit(s|ty|ties)$', '^cum(s|ming)?$', '^nigs?$', '^fags?$', '^kikes?$', '^spics?$', '^chink(s|y)?$', '^gooks?$',
  '^wops?$', '^dago(s|es)?$', '^coons?$', '^japs?$', '^pakis?$', '^retard(s|ed)?$', '^spaz.*', '^dykes?$', '^homos?$',
  '^gyp(s|ped|ping)?$', '^krauts?$', '^arse(s|hole.*)?$', '^turds?$', '^craps?$', '^crapp.*',
].join('|'));
const refused = w => listed.has(w) || RUDE.test(w);

// Nor one of those with -s, -es, -d or -ed on the end, or -y turned to -ies (clits, asses, arsed, orgies), apart
// from a few plain words that only look like one.
const ENDINGS = [['s', ''], ['es', ''], ['ed', ''], ['ed', 'e'], ['ies', 'y']];
const PLAIN = new Set(['spices', 'spiced', 'crapes', 'buttes', 'japes', 'japed']);

export function isRude(word) {
  const w = word.toLowerCase();
  if (refused(w)) return true;
  if (PLAIN.has(w)) return false;
  return ENDINGS.some(([end, add]) => w.endsWith(end) && w.length - end.length >= 3 && refused(w.slice(0, -end.length) + add));
}
