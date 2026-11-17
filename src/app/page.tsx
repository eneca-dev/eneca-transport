/**
 * Э1 «Мои поездки». Список заявок появится в И2 вместе с самими поездками —
 * до тех пор здесь только объяснение, чтобы вкладка не открывалась пустой.
 */
export default function Home() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Мои поездки</h1>
      <p className="mt-2 text-sm text-gray-600">
        Список заявок появится, когда будет готово создание поездки.
      </p>
    </div>
  );
}
