import { db, fresh, type AppDB, type Goal, type Weight } from './db';
import { notify } from './webhook';

/** Save weight and goal. Every change is reported to the webhook, if one is set up. */

/** Records the weight of a day; an existing value for that day is replaced. */
export async function saveWeight(date: string, kg: number, database: AppDB = db): Promise<Weight> {
  const existing = (await database.weights.where('date').equals(date).toArray()).find((weight) => !weight.deleted);
  const weight: Weight = { ...(existing ?? fresh()), date, kg, deleted: 0, updatedAt: Date.now() };
  await database.weights.put(weight);
  notify({ event: 'weight.set', weight }, database);
  return weight;
}

export async function removeWeight(id: string, database: AppDB = db): Promise<void> {
  const weight = await database.weights.get(id);
  await database.weights.update(id, { deleted: 1, updatedAt: Date.now() });
  if (weight) notify({ event: 'weight.deleted', weight }, database);
}

/** Sets the goal from a day on. A goal that begins on the same day is replaced. */
export async function saveGoal(
  validFrom: string,
  values: Pick<Goal, 'kcal' | 'protein' | 'carbs' | 'fat'>,
  database: AppDB = db,
): Promise<Goal> {
  const sameDay = (await database.goals.toArray()).find((goal) => !goal.deleted && goal.validFrom === validFrom);
  const goal: Goal = { ...(sameDay ?? fresh()), ...values, validFrom, deleted: 0, updatedAt: Date.now() };
  await database.goals.put(goal);
  notify({ event: 'goal.changed', goal }, database);
  return goal;
}
