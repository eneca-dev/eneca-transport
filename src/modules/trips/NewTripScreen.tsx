'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useTeamsAuth } from '@/components/TeamsAuth';

import { createTrip, loadTripOptions } from './actions';
import { fromMinskInput, toMinskDate } from './booking';
import { CarDriverStep } from './CarDriverStep';
import { ReviewStep } from './ReviewStep';
import { TripDetailsStep } from './TripDetailsStep';

import type { TripOptions } from './actions';
import type { TripDetails } from './TripDetailsStep';

/** Э2 «Новая поездка»: данные → машина и водитель → проверка и отправка. */

/**
 * Завтрашний день по минскому времени, а не по UTC: после 21:00 по Минску в
 * UTC ещё вчера, и `toISOString()` подставил бы в форму не тот день.
 */
function tomorrowInMinsk(): string {
  return toMinskDate(new Date(Date.now() + 86_400_000));
}

function emptyDetails(): TripDetails {
  const date = tomorrowInMinsk();
  return {
    startDate: date,
    startTime: '07:00',
    endDate: date,
    endTime: '19:00',
    route: '',
    contract: '',
    purpose: '',
    participants: [],
    needsDriver: false,
  };
}

export function NewTripScreen() {
  const { getToken } = useTeamsAuth();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [details, setDetails] = useState<TripDetails>(emptyDetails);
  const [options, setOptions] = useState<TripOptions | null>(null);
  const [carId, setCarId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startsAt = fromMinskInput(details.startDate, details.startTime);
  const endsAt = fromMinskInput(details.endDate, details.endTime);

  /** Шаг 1 → 2: занятость спрашиваем у сервера, в браузере её знать неоткуда. */
  function goToOptions() {
    if (!details.route.trim()) {
      setError('Укажите маршрут.');
      return;
    }
    if (!details.contract.trim() || !details.purpose.trim()) {
      setError('Заполните договор и цель поездки.');
      return;
    }
    if (!startsAt || !endsAt) {
      setError('Проверьте даты и время поездки.');
      return;
    }
    if (endsAt <= startsAt) {
      setError('Возврат должен быть позже выезда.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await loadTripOptions(
          await getToken(),
          details.startDate,
          details.startTime,
          details.endDate,
          details.endTime,
        );
        if (result.success) {
          setOptions(result.data);
          setError(null);
          // Прежний выбор мог стать занятым на новых датах.
          setCarId(null);
          setDriverId(null);
          setStep(2);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }

  function submit() {
    if (!carId) {
      setError('Выберите машину.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await createTrip(await getToken(), {
          startDate: details.startDate,
          startTime: details.startTime,
          endDate: details.endDate,
          endTime: details.endTime,
          route: details.route,
          contract: details.contract,
          purpose: details.purpose,
          participantIds: details.participants.map((person) => person.id),
          needsDriver: details.needsDriver,
          carId,
          driverId: details.needsDriver ? driverId : null,
        });

        if (result.success) {
          router.push(`/trips/${result.data.tripId}`);
          return;
        }

        setError(result.error);
        // Машину или водителя увели, пока заполняли: возвращаемся к выбору со
        // свежей занятостью, как требует спецификация.
        if (result.error.includes('только что')) {
          const fresh = await loadTripOptions(
            await getToken(),
            details.startDate,
            details.startTime,
            details.endDate,
            details.endTime,
          );
          if (fresh.success) {
            setOptions(fresh.data);
            setCarId(null);
            setDriverId(null);
            setStep(2);
          }
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Новая поездка</h1>
        <span className="text-sm text-fg-soft">шаг {step} из 3</span>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        {step === 1 && (
          <TripDetailsStep
            value={details}
            pending={pending}
            onChange={setDetails}
            onNext={goToOptions}
          />
        )}

        {step === 2 && options && startsAt && endsAt && (
          <CarDriverStep
            options={options}
            startsAt={startsAt}
            endsAt={endsAt}
            needsDriver={details.needsDriver}
            carId={carId}
            driverId={driverId}
            pending={pending}
            onPickCar={setCarId}
            onPickDriver={setDriverId}
            onBack={() => {
              setError(null);
              setStep(1);
            }}
            onNext={() => {
              setError(null);
              setStep(3);
            }}
          />
        )}

        {step === 3 && options && carId && startsAt && endsAt && (
          <ReviewStep
            details={details}
            options={options}
            carId={carId}
            driverId={driverId}
            startsAt={startsAt}
            endsAt={endsAt}
            pending={pending}
            onBack={() => {
              setError(null);
              setStep(2);
            }}
            onSubmit={submit}
          />
        )}
      </div>
    </section>
  );
}
