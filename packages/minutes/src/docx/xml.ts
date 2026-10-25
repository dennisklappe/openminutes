const isXmlChar = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
};

export const escapeXml = (value: string) =>
  Array.from(value)
    .filter(isXmlChar)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
