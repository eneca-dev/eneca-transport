import 'server-only';

import { getDb } from '@/config/supabase';

import { listOpenRemarks } from './remarks';

import type { CarRemark } from './remarks';

export interface Car {
  id: string;
  plate: string;
  model: string;
  odometerKm: number | null;
  comment: string | null;
  isActive: boolean;
  /** Открытый период ремонта: машина в ремонте прямо сейчас. */
  inRepair: boolean;
  /** Причина и начало текущего ремонта, если он идёт. */
  repairNote: string | null;
  repairSince: string | null;
  /** Замечания и примечания из возвратов, которые АХО ещё не закрыла. */
  remarks: CarRemark[];
}

interface CarRow {
  id: string;
  plate: string;
  model: string;
  odometer_km: number | null;
  comment: string | null;
  is_active: boolean;
  in_repair: boolean;
}

interface OpenRepairRow {
  car_id: string;
  since: string;
  note: string | null;
}

/**
 * Справочник машин для Э8. Признак ремонта берётся из представления `v_cars`,
 * которое смотрит на открытый период в `car_repairs`: ремонт — это период, а
 * не поле статуса, иначе его не нарисовать в календаре Э6.
 */
export async function listCars(): Promise<Car[]> {
  const db = getDb();

  const { data: cars, error } = await db
    .from('v_cars')
    .select('id, plate, model, comment, odometer_km, is_active, in_repair')
    .order('plate')
    .returns<CarRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать машины: ${error.message}`);
  }

  const { data: repairs, error: repairsError } = await db
    .from('car_repairs')
    .select('car_id, since, note')
    .is('until', null)
    .returns<OpenRepairRow[]>();

  if (repairsError) {
    throw new Error(`Не удалось прочитать ремонты: ${repairsError.message}`);
  }

  const openRepairs = new Map((repairs ?? []).map((r) => [r.car_id, r]));

  const remarks = await listOpenRemarks();
  const remarksByCar = new Map<string, CarRemark[]>();
  for (const remark of remarks) {
    remarksByCar.set(remark.carId, [...(remarksByCar.get(remark.carId) ?? []), remark]);
  }

  return (cars ?? []).map((car) => {
    const repair = openRepairs.get(car.id);
    return {
      id: car.id,
      plate: car.plate,
      model: car.model,
      odometerKm: car.odometer_km,
      comment: car.comment,
      isActive: car.is_active,
      inRepair: car.in_repair,
      repairNote: repair?.note ?? null,
      repairSince: repair?.since ?? null,
      remarks: remarksByCar.get(car.id) ?? [],
    };
  });
}
