'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { useNavCounts } from '@/components/NavCounts';
import { counted } from '@/lib/plural';

/**
 * «Требует внимания» на первом экране: что ждёт в служебных разделах.
 *
 * Нужно тем, у кого есть роль: рецепция и финотдел не должны помнить, что надо
 * зайти в свой раздел и посмотреть, не появилось ли дело. Числа те же, что в
 * точках у разделов, и считаются из данных — строка исчезает, когда работа
 * сделана.
 *
 * Когда ждать нечего, блок не рисуется вовсе: «всё хорошо» каждый день
 * перестают читать за неделю, а вместе с ним перестают читать и то, где не
 * всё хорошо.
 */

interface Line {
  href: string;
  text: string;
}

export function RoleAttention() {
  const { counts } = useNavCounts();

  if (!counts) {
    return null;
  }

  const lines: Line[] = [];

  if (counts.reception > 0) {
    lines.push({
      href: '/reception',
      text: `Рецепция: ${counted(counts.reception, ['дело', 'дела', 'дел'])}`,
    });
  }
  if (counts.documents > 0) {
    lines.push({
      href: '/documents',
      text: `Документы: ${counted(counts.documents, ['заявка', 'заявки', 'заявок'])}`,
    });
  }
  if (counts.cars > 0) {
    lines.push({
      href: '/cars',
      text: `Замечания по машинам: ${counts.cars}`,
    });
  }

  if (lines.length === 0) {
    return null;
  }

  return (
    <ul className="mb-4 flex flex-wrap gap-2">
      {lines.map((line) => (
        <li key={line.href}>
          <Link
            href={line.href}
            className="inline-flex items-center gap-1.5 rounded-md border border-bad-line bg-bad px-3 py-1.5 text-sm font-medium text-bad-fg transition-opacity hover:opacity-80"
          >
            {line.text}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
