/**
 * Русское число с правильной формой слова: «1 дело», «2 дела», «5 дел».
 *
 * Нужно там, где число приходит из данных: «найдено 2 заявка» выглядит как
 * ошибка приложения, и доверие к остальным цифрам тоже падает.
 *
 * Правило: одна форма для 1 (кроме 11), вторая для 2–4 (кроме 12–14), третья
 * для остального.
 */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;

  if (n > 10 && n < 20) {
    return forms[2];
  }
  if (last > 1 && last < 5) {
    return forms[1];
  }
  if (last === 1) {
    return forms[0];
  }
  return forms[2];
}

/** «3 дела» — число вместе со словом. */
export function counted(count: number, forms: [string, string, string]): string {
  return `${count} ${plural(count, forms)}`;
}
