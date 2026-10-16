import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, stripRich, toggleFormat } from '../client/src/rich-text.js';

test('toggleFormat wraps the selection and toggles it off again', () => {
  const on = toggleFormat('hola mundo', 5, 10, FORMATS.bold.marker);
  assert.deepEqual(on, { value: 'hola **mundo**', start: 7, end: 12 });
  assert.deepEqual(toggleFormat(on.value, on.start, on.end, '**'), { value: 'hola mundo', start: 5, end: 10 });
  assert.deepEqual(toggleFormat('hola **mundo**', 5, 14, '**'), { value: 'hola mundo', start: 5, end: 10 });
});

test('toggleFormat keeps spaces outside and inserts a placeholder without selection', () => {
  assert.equal(toggleFormat('hola mundo ', 5, 11, '==').value, 'hola ==mundo== ');
  assert.deepEqual(toggleFormat('hola ', 5, 5, '*'), { value: 'hola *texto*', start: 6, end: 11 });
});

test('stripRich removes markers (also nested) and leaves lone symbols alone', () => {
  assert.equal(stripRich('Mujer de **74 años** con ==SF3B1== y *IPSS-M*'), 'Mujer de 74 años con SF3B1 y IPSS-M');
  assert.equal(stripRich('***texto***'), 'texto');
  assert.equal(stripRich('**anidado *aquí***'), 'anidado aquí');
  assert.equal(stripRich('==**alto** riesgo=='), 'alto riesgo');
  assert.equal(stripRich('p<0.05* y 2 * 3 = 6'), 'p<0.05* y 2 * 3 = 6');
});
