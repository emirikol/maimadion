import { describe, expect, it } from 'vitest';
import { formatComputed, literalToValue } from './value';

describe('literalToValue', () => {
  it('reads numeric text as a number', () => {
    expect(literalToValue('42')).toEqual({ kind: 'number', n: 42 });
    expect(literalToValue('3.14159')).toEqual({ kind: 'number', n: 3.14159 });
    expect(literalToValue('-5')).toEqual({ kind: 'number', n: -5 });
    expect(literalToValue('1e3')).toEqual({ kind: 'number', n: 1000 });
  });
  it('keeps non-numeric text as text', () => {
    expect(literalToValue('hello')).toEqual({ kind: 'text', s: 'hello' });
    expect(literalToValue('1,000')).toEqual({ kind: 'text', s: '1,000' });
    expect(literalToValue('3.14 pies')).toEqual({ kind: 'text', s: '3.14 pies' });
  });
});

describe('formatComputed', () => {
  it('formats values and errors', () => {
    expect(formatComputed({ value: { kind: 'empty' } })).toBe('');
    expect(formatComputed({ value: { kind: 'number', n: 42 } })).toBe('42');
    expect(formatComputed({ value: { kind: 'text', s: 'hi' } })).toBe('hi');
    expect(formatComputed({ error: '#CYCLE!' })).toBe('#CYCLE!');
  });
  it('trims binary-float noise', () => {
    expect(formatComputed({ value: { kind: 'number', n: 0.1 + 0.2 } })).toBe('0.3');
  });
});
