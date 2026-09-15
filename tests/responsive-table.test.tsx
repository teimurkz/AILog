import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponsiveTable } from '../src/components/common/ResponsiveTable';

test('mobile record labels retain the relationship to headers, including totals with colspan', () => {
  const html = renderToStaticMarkup(<ResponsiveTable>
    <thead><tr><th>Инвойс</th><th><span>Всего</span> паллет</th><th>Свободно</th></tr></thead>
    <tbody>{['00389', '00390'].map(id => <tr key={id}><td>{id}</td><td>22</td><td>18</td></tr>)}</tbody>
    <tfoot><tr><td colSpan={2}>Итого</td><td>36</td></tr></tfoot>
  </ResponsiveTable>);
  assert.match(html, /data-label="Инвойс">00389/);
  assert.match(html, /data-label="Всего паллет">22/);
  assert.match(html, /colSpan="2" role="cell" data-full-row="true">Итого/);
  assert.match(html, /data-label="Свободно">36/);
});

test('selection and action controls are rendered once and keep their original properties', () => {
  const html = renderToStaticMarkup(<ResponsiveTable wide>
    <thead><tr><th><input type="checkbox" defaultChecked /></th><th>Документ</th><th>Действия</th></tr></thead>
    <tbody><><tr><td><input type="checkbox" aria-label="Инвойс 389" /></td><td>Invoice_00389.xlsx</td><td><button disabled>Открыть</button></td></tr></></tbody>
  </ResponsiveTable>);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  assert.match(html, /Выбрать все/);
  assert.match(html, /aria-label="Инвойс 389"/);
  assert.match(html, /data-label="Документ">Invoice_00389.xlsx/);
  assert.match(html, /<button disabled="">Открыть/);
});

test('empty-state and expanded rows span the record without inheriting an unrelated header', () => {
  const html = renderToStaticMarkup(<ResponsiveTable>
    <thead><tr><th>Инвойс</th><th>Дата</th></tr></thead>
    <tbody><tr><td colSpan={2}><p>Нет записей</p></td></tr></tbody>
  </ResponsiveTable>);
  assert.match(html, /data-full-row="true"><p>Нет записей/);
  assert.ok(!html.includes('data-label='));
});
