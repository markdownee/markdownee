import { createHash } from 'node:crypto';

export interface ContentInfo {
  hash: string;
  length: number;
}

export function computeContentInfo(content: string | Buffer): ContentInfo {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return {
    hash: createHash('md5').update(buf).digest('hex'),
    length: buf.length,
  };
}
