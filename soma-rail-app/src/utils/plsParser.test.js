import { describe, it, expect } from 'vitest';
import { parsePLS } from './plsParser';

describe('PLS Parser', () => {
  it('should parse a valid PLS file (defaults to ice3)', () => {
    const plsContent = `[playlist]
NumberOfEntries=1
File1=https://ice1.somafm.com/groovesalad-128-mp3
Title1=Groove Salad
Length1=-1
Version=2`;

    const url = parsePLS(plsContent);
    expect(url).toBe('https://ice3.somafm.com/groovesalad-128-mp3');
  });

  it('should replace ice2 with ice3 (default)', () => {
    const plsContent = `[playlist]
File1=https://ice2.somafm.com/groovesalad-128-mp3`;

    const url = parsePLS(plsContent);
    expect(url).toBe('https://ice3.somafm.com/groovesalad-128-mp3');
  });

  it('should replace ice1 with ice3 (default)', () => {
    const plsContent = `[playlist]
File1=https://ice1.somafm.com/groovesalad-128-mp3`;

    const url = parsePLS(plsContent);
    expect(url).toBe('https://ice3.somafm.com/groovesalad-128-mp3');
  });

  it('should allow specifying ice1 explicitly', () => {
    const plsContent = `[playlist]
File1=https://ice2.somafm.com/groovesalad-128-mp3`;

    const url = parsePLS(plsContent, 'ice1');
    expect(url).toBe('https://ice1.somafm.com/groovesalad-128-mp3');
  });

  it('should preserve original server when specified', () => {
    const plsContent = `[playlist]
File1=https://ice2.somafm.com/groovesalad-128-mp3`;

    const url = parsePLS(plsContent, 'original');
    expect(url).toBe('https://ice2.somafm.com/groovesalad-128-mp3');
  });

  it('should handle File1 with trailing whitespace', () => {
    const plsContent = `[playlist]
File1=https://ice1.somafm.com/groovesalad-128-mp3   `;

    const url = parsePLS(plsContent);
    expect(url).toBe('https://ice3.somafm.com/groovesalad-128-mp3');
  });

  it('should return null for invalid PLS', () => {
    const plsContent = `Invalid content`;
    const url = parsePLS(plsContent);
    expect(url).toBeNull();
  });

  it('should return null for empty string', () => {
    const url = parsePLS('');
    expect(url).toBeNull();
  });
});
