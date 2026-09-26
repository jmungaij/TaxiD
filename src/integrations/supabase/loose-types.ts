/**
 * Permissive database typing for the Supabase client.
 *
 * Why this exists
 * ---------------
 * The connected Lovable Cloud backend currently contains only the tables
 * created through it (e.g. `user_roles`), so the generated `types.ts` only
 * describes those. The application was built against a much larger schema
 * (trips, wallets, deliveries, charter, corporate, academy, ...). Typing the
 * client with the generated types makes every legitimate query a compile
 * error.
 *
 * `LooseDatabase` keeps the same client shape but treats unknown tables,
 * views and functions as generic rows. Query results are unverified — narrow
 * them at the call site, exactly as with `untypedDb`.
 *
 * Migration path: as the real schema is recreated in the backend and the
 * generated types catch up, switch `client.ts` back to the generated
 * `Database` type and delete this module.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

interface LooseTable {
  Row: AnyRow
  Insert: AnyRow
  Update: AnyRow
  Relationships: {
    foreignKeyName: string
    columns: string[]
    isOneToOne: boolean
    referencedRelation: string
    referencedColumns: string[]
  }[]
}

interface LooseFunction {
  Args: Record<string, unknown>
  Returns: AnyRow
}

export type LooseDatabase = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      [table: string]: LooseTable
    }
    Views: {
      [view: string]: LooseTable
    }
    Functions: {
      [fn: string]: LooseFunction
    }
    Enums: {
      [enumName: string]: string
    }
    CompositeTypes: {
      [composite: string]: Record<string, unknown>
    }
  }
}
