import React, { Children, Fragment, cloneElement, isValidElement, type ReactNode } from 'react';

function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) && typeof child.type === 'string'
      ? textContent(child.props.children) : '';
  }).join(' ').replace(/\s+/g, ' ').trim();
}

function cells(node: ReactNode): React.ReactElement<any>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === 'th') return [child];
    return ['thead', 'tr', Fragment].includes(child.type as any) ? cells(child.props.children) : [];
  });
}

/** Keeps the same cells, controls and row handlers when a table becomes cards. */
export function ResponsiveTable({ children, className = '', wide = false, ...props }:
  React.TableHTMLAttributes<HTMLTableElement> & { wide?: boolean }) {
  const headers = cells(children).map(cell => textContent(cell.props.children));
  function decorate(nodes: ReactNode): ReactNode {
    return Children.map(nodes, node => {
      if (!isValidElement<any>(node)) return node;
      const element = node as React.ReactElement<any>;
      if (element.type === 'tr') {
        let column = 0;
        return cloneElement(element, { role: 'row' }, Children.map(element.props.children, cell => {
          if (!isValidElement<any>(cell)) return cell;
          const index = column;
          column += cell.props.colSpan || 1;
          if (cell.type !== 'td' && cell.type !== 'th') return cell;
          const selectionHeader = cell.type === 'th' && !headers[index] &&
            Children.toArray(cell.props.children).some(child => isValidElement(child) && child.type === 'input' && (child.props as React.InputHTMLAttributes<HTMLInputElement>).type === 'checkbox');
          return cloneElement(cell, {
            role: cell.type === 'th' ? 'columnheader' : 'cell',
            ...(cell.type === 'td' && (cell.props.colSpan || 1) === 1 && headers[index]
              ? { 'data-label': headers[index] } : {}),
            ...(cell.props.colSpan > 1 ? { 'data-full-row': true } : {}),
          }, selectionHeader ? <label className="inline-flex items-center gap-2">
            {cell.props.children}<span className="crm-select-all-label">Выбрать все</span>
          </label> : cell.props.children);
        }));
      }
      if (['thead', 'tbody', 'tfoot', Fragment].includes(element.type as any)) {
        return cloneElement(element, element.type === Fragment ? {} : { role: 'rowgroup' }, decorate(element.props.children));
      }
      return node;
    });
  }
  return <div className={`crm-table-region${wide ? ' crm-table-wide' : ''}`}>
    <table {...props} role="table" className={`crm-table ${className}`}>{decorate(children)}</table>
  </div>;
}
