'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { useNavCounts } from '@/components/NavCounts';
import { counted } from '@/lib/plural';

/**
 * Что требует внимания по роли — на первом экране, двумя уровнями.
 *
 * Сверху проблемы **чужих** поездок, названные по имени: «Брест/23–24.11 ·
 * машина не вернулась». Чужих — потому что своих в этом блоке нет: по ним
 * проблема видна рамкой в строке списка ниже, и две записи об одной поездке на
 * одном экране были бы повтором. Зато поездки, где человек ни автор, ни
 * участник, в его списке не появятся вовсе, и сказать о них можно только здесь:
 * невернувшаяся машина — дело рецепции, а не того, кто на ней ездил.
 *
 * Ниже спокойные числа по разделам серым — заявки в очереди, выдачи на вторую
 * половину дня, замечания по машинам. Разделение нужно, потому что одинаково
 * яркая метка на всём забирает внимание и перестаёт значить что-либо.
 *
 * Когда ждать нечего, блока нет вовсе: «всё хорошо» каждый день перестают
 * читать за неделю, а вместе с ним перестают читать и то, где не всё хорошо.
 */

interface Chip {
  href: string;
  text: string;
}

export function RoleAttention() {
  const { counts } = useNavCounts();

  if (!counts) {
    return null;
  }

  const chips: Chip[] = [];

  // Спокойные числа пишутся действием, а не словом «дел»: «выдать 2» понятно
  // без объяснений, «2 дела» — нет.
  if (counts.reception.total > 0) {
    const parts: string[] = [];
    if (counts.reception.toIssue > 0) {
      parts.push(`выдать ${counts.reception.toIssue}`);
    }
    if (counts.reception.toAccept > 0) {
      parts.push(`принять ${counts.reception.toAccept}`);
    }
    chips.push({ href: '/reception', text: `Рецепция · ${parts.join(' · ')}` });
  }

  if (counts.documents.total > 0) {
    chips.push({ href: '/documents', text: `Документы · проверить ${counts.documents.total}` });
  }

  if (counts.cars.total > 0) {
    chips.push({
      href: '/cars',
      text: `Машины · ${counted(counts.cars.total, ['замечание', 'замечания', 'замечаний'])}`,
    });
  }

  // «Не выехали» — не срочное, а разбор: за ключами не пришли вовсе. Красным
  // такое помечать нельзя, но и теряться оно не должно.
  if (counts.reception.stale > 0) {
    chips.push({
      href: '/reception',
      text: `Не выехали · ${counts.reception.stale}`,
    });
  }

  if (counts.urgent.length === 0 && chips.length === 0) {
    return null;
  }

  return (
    <div className="mb-5">
      {counts.urgent.length > 0 && (
        <ul className="mb-3 space-y-2">
          {counts.urgent.map((row) => (
            <li key={row.tripId}>
              <Link
                href={row.href}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-bad-line bg-bad px-4 py-2.5 text-sm text-bad-fg transition-opacity hover:opacity-80"
              >
                <span className="font-semibold">{row.label}</span>
                <span>· {row.what}</span>
                {row.when && <span className="opacity-80">· {row.when}</span>}
                <ArrowRight className="size-3.5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.href}>
              <Link
                href={chip.href}
                className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-soft px-3 py-1.5 text-sm text-fg-soft transition-colors hover:text-fg"
              >
                {chip.text}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
