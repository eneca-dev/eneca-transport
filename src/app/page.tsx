import { CARD } from '@/components/controls';

/**
 * Э1 «Мои поездки». Список заявок появится в И2 вместе с самими поездками —
 * до тех пор здесь только объяснение, чтобы вкладка не открывалась пустой.
 */
export default function Home() {
  return (
    <div className={`${CARD} p-6`}>
      <h1 className="text-lg font-semibold">Мои поездки</h1>
      <p className="mt-2 text-sm text-fg-soft">
        Список заявок появится, когда будет готово создание поездки.
      </p>
    </div>
  );
}
