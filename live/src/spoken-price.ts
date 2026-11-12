const units = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function integer(words: string[]): number | undefined {
  if (words.length === 0) return 0;
  if (words.length === 1 && units.includes(words[0])) return units.indexOf(words[0]);
  const tensDigit = tens.indexOf(words[0]);
  if (tensDigit >= 2 && words.length === 1) return tensDigit * 10;
  const unitDigit = units.indexOf(words[1]);
  if (tensDigit >= 2 && words.length === 2 && unitDigit >= 1 && unitDigit < 10) return tensDigit * 10 + unitDigit;
  const hundreds = units.indexOf(words[0]);
  if (hundreds >= 1 && hundreds <= 9 && words[1] === 'hundred' && !words.slice(2).includes('hundred')) {
    const rest = integer(words.slice(words[2] === 'and' ? 3 : 2));
    if (rest !== undefined) return hundreds * 100 + rest;
  }
}

export function spokenPrice(text: string) {
  const phrase = text.toLowerCase().replace(/[!?.,]+$/g, '').trim();
  if (/^\d+(\.\d+)?$/.test(phrase)) return Number(phrase);
  if (!phrase) return undefined;
  const parts = phrase.replaceAll('-', ' ').split(/\s+point\s+/);
  if (parts.length > 2) return undefined;
  const whole = integer(parts[0].trim().split(/\s+/));
  if (whole === undefined) return undefined;
  if (parts.length === 1) return whole;
  const digits = parts[1].trim().split(/\s+/).map(word => units.indexOf(word));
  return digits.every(digit => digit >= 0 && digit < 10) ? Number(`${whole}.${digits.join('')}`) : undefined;
}
