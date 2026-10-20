import { type Pool } from 'pg';

/** Domande alla regola, direttamente alle funzioni SQL (strato dell'ultima difesa). */
export class Rule {
  constructor(private readonly pool: Pool) {}

  async fn(
    name:
      'can_see' | 'can_interact' | 'company_conflict' | 'mutual_open_space' | 'exclusion_active',
    a: string,
    b: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query<{ r: boolean }>(`select ${name}($1, $2) as r`, [a, b]);
    return rows[0]!.r;
  }

  canSee(a: string, b: string): Promise<boolean> {
    return this.fn('can_see', a, b);
  }

  /** Visibilità nei due sensi, verificata con le due domande separate (architettura, RC). */
  async seeEachOther(
    a: string,
    b: string,
  ): Promise<{ ab: boolean; ba: boolean; interact: boolean }> {
    return {
      ab: await this.fn('can_see', a, b),
      ba: await this.fn('can_see', b, a),
      interact: await this.fn('can_interact', a, b),
    };
  }

  async canWrite(sender: string, matchId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ r: boolean }>('select can_write($1, $2) as r', [
      sender,
      matchId,
    ]);
    return rows[0]!.r;
  }

  async matchStatus(matchId: string): Promise<{ status: string; close_reason: string | null }> {
    const { rows } = await this.pool.query<{ status: string; close_reason: string | null }>(
      'select status, close_reason from matches where id = $1',
      [matchId],
    );
    return rows[0]!;
  }

  async likeExists(from: string, to: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'select 1 from swipes where from_user_id = $1 and to_user_id = $2',
      [from, to],
    );
    return rowCount === 1;
  }
}

/** SQLSTATE di un errore di PostgreSQL, o `null` se l'operazione riesce. */
export async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}
