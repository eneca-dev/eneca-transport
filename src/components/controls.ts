/**
 * Классы элементов управления. Один набор на все экраны: поля и кнопки должны
 * выглядеть одинаково в справочниках, заявках и на рецепции.
 *
 * Цвета здесь — токены темы Teams (см. globals.css), поэтому и в тёмной теме
 * ничего менять не нужно.
 */

export const FIELD =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-soft focus:border-brand focus:ring-2 focus:ring-brand/30';

export const BUTTON_PRIMARY =
  'rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50';

export const BUTTON_PRIMARY_SM =
  'flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50';

export const BUTTON_SECONDARY =
  'rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:bg-surface-soft disabled:opacity-50';

export const BUTTON_GHOST =
  'rounded-md px-4 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-soft disabled:opacity-50';

/** Карточка: белый лист на фоне страницы. */
export const CARD = 'rounded-lg border border-line bg-surface';

/**
 * Значок состояния: цветная плашка с точкой. Цвет несёт смысл, поэтому рядом
 * всегда стоит слово — иначе состояние не прочитать ни в высокой контрастности,
 * ни тому, кто не различает цвета.
 */
export const BADGE =
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium';

/** Точка внутри значка. Берёт цвет текста плашки. */
export const BADGE_DOT = 'size-2 shrink-0 rounded-full bg-current';
