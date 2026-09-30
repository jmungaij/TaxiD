export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      ai_answer_ledger: {
        Row: {
          asked_by: string
          confidence: number
          created_at: string
          data_quality: number
          domains: string[]
          estimate_count: number
          fact_count: number
          freshest_at: string | null
          gate_failures: string[]
          id: string
          intent: string
          latency_ms: number | null
          prediction_count: number
          question: string
          recommendation_count: number
          verdict: string
        }
        Insert: {
          asked_by?: string
          confidence?: number
          created_at?: string
          data_quality?: number
          domains?: string[]
          estimate_count?: number
          fact_count?: number
          freshest_at?: string | null
          gate_failures?: string[]
          id?: string
          intent: string
          latency_ms?: number | null
          prediction_count?: number
          question: string
          recommendation_count?: number
          verdict: string
        }
        Update: {
          asked_by?: string
          confidence?: number
          created_at?: string
          data_quality?: number
          domains?: string[]
          estimate_count?: number
          fact_count?: number
          freshest_at?: string | null
          gate_failures?: string[]
          id?: string
          intent?: string
          latency_ms?: number | null
          prediction_count?: number
          question?: string
          recommendation_count?: number
          verdict?: string
        }
        Relationships: []
      }
      ai_security_ledger: {
        Row: {
          authentication_impact: boolean
          authorization_impact: boolean
          category: string
          evidence: Json
          exploitability: string
          financial_impact: boolean
          finding_count: number
          finding_key: string
          id: string
          production_blocker: boolean
          recorded_at: string
          remediation_status: string
          risk_acceptance_note: string | null
          rls_impact: boolean
          secret_exposure: boolean
          severity: string
          tenant_impact: boolean
          updated_at: string
        }
        Insert: {
          authentication_impact?: boolean
          authorization_impact?: boolean
          category: string
          evidence?: Json
          exploitability: string
          financial_impact?: boolean
          finding_count?: number
          finding_key: string
          id?: string
          production_blocker?: boolean
          recorded_at?: string
          remediation_status?: string
          risk_acceptance_note?: string | null
          rls_impact?: boolean
          secret_exposure?: boolean
          severity: string
          tenant_impact?: boolean
          updated_at?: string
        }
        Update: {
          authentication_impact?: boolean
          authorization_impact?: boolean
          category?: string
          evidence?: Json
          exploitability?: string
          financial_impact?: boolean
          finding_count?: number
          finding_key?: string
          id?: string
          production_blocker?: boolean
          recorded_at?: string
          remediation_status?: string
          risk_acceptance_note?: string | null
          rls_impact?: boolean
          secret_exposure?: boolean
          severity?: string
          tenant_impact?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      airport_bookings: {
        Row: {
          airport_code: string
          created_at: string
          direction: string
          flight_number: string | null
          flight_time: string | null
          id: string
          luggage_count: number
          meet_and_greet: boolean | null
          notes: string | null
          passenger_count: number
          terminal: string | null
          trip_booking_id: string | null
          user_id: string
          vip: boolean | null
        }
        Insert: {
          airport_code: string
          created_at?: string
          direction: string
          flight_number?: string | null
          flight_time?: string | null
          id?: string
          luggage_count?: number
          meet_and_greet?: boolean | null
          notes?: string | null
          passenger_count?: number
          terminal?: string | null
          trip_booking_id?: string | null
          user_id: string
          vip?: boolean | null
        }
        Update: {
          airport_code?: string
          created_at?: string
          direction?: string
          flight_number?: string | null
          flight_time?: string | null
          id?: string
          luggage_count?: number
          meet_and_greet?: boolean | null
          notes?: string | null
          passenger_count?: number
          terminal?: string | null
          trip_booking_id?: string | null
          user_id?: string
          vip?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "airport_bookings_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      ap360_tax_rules: {
        Row: {
          active: boolean
          authority: string
          code: string
          created_at: string
          effective_from: string
          effective_to: string | null
          family_codes: string[]
          geography: string
          inclusive: boolean
          label: string
          rate_pct: number
          source: string
          tax_type: string
          taxable_status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          authority?: string
          code: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          family_codes?: string[]
          geography?: string
          inclusive?: boolean
          label: string
          rate_pct: number
          source?: string
          tax_type?: string
          taxable_status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          authority?: string
          code?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          family_codes?: string[]
          geography?: string
          inclusive?: boolean
          label?: string
          rate_pct?: number
          source?: string
          tax_type?: string
          taxable_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_download_clicks: {
        Row: {
          audience: string
          browser: string | null
          created_at: string
          device_type: string | null
          id: string
          os: string | null
          placement: string
          platform: string
        }
        Insert: {
          audience: string
          browser?: string | null
          created_at?: string
          device_type?: string | null
          id?: string
          os?: string | null
          placement: string
          platform: string
        }
        Update: {
          audience?: string
          browser?: string | null
          created_at?: string
          device_type?: string | null
          id?: string
          os?: string | null
          placement?: string
          platform?: string
        }
        Relationships: []
      }
      approval_payment_links: {
        Row: {
          consumption_id: string | null
          corporate_invoice_id: string | null
          id: string
          journal_id: string | null
          linked_at: string
          request_id: string
          revenue_event_id: string | null
        }
        Insert: {
          consumption_id?: string | null
          corporate_invoice_id?: string | null
          id?: string
          journal_id?: string | null
          linked_at?: string
          request_id: string
          revenue_event_id?: string | null
        }
        Update: {
          consumption_id?: string | null
          corporate_invoice_id?: string | null
          id?: string
          journal_id?: string | null
          linked_at?: string
          request_id?: string
          revenue_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_payment_links_consumption_id_fkey"
            columns: ["consumption_id"]
            isOneToOne: false
            referencedRelation: "budget_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_payment_links_corporate_invoice_id_fkey"
            columns: ["corporate_invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_payment_links_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_payment_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_payment_links_revenue_event_id_fkey"
            columns: ["revenue_event_id"]
            isOneToOne: false
            referencedRelation: "revenue_events"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          amount_cents: number
          budget_id: string | null
          corporate_id: string
          cost_center_id: string | null
          created_at: string
          currency: string
          current_step: number
          due_at: string | null
          id: string
          justification: string | null
          metadata: Json
          reference: string | null
          requested_by: string
          reservation_id: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["approval_request_status"]
          updated_at: string
          workflow_id: string
        }
        Insert: {
          amount_cents: number
          budget_id?: string | null
          corporate_id: string
          cost_center_id?: string | null
          created_at?: string
          currency?: string
          current_step?: number
          due_at?: string | null
          id?: string
          justification?: string | null
          metadata?: Json
          reference?: string | null
          requested_by: string
          reservation_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_request_status"]
          updated_at?: string
          workflow_id: string
        }
        Update: {
          amount_cents?: number
          budget_id?: string | null
          corporate_id?: string
          cost_center_id?: string | null
          created_at?: string
          currency?: string
          current_step?: number
          due_at?: string | null
          id?: string
          justification?: string | null
          metadata?: Json
          reference?: string | null
          requested_by?: string
          reservation_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_request_status"]
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "budget_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_workflows: {
        Row: {
          active: boolean
          corporate_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          sla_minutes: number
          trigger_predicate: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          corporate_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sla_minutes?: number
          trigger_predicate?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          corporate_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sla_minutes?: number
          trigger_predicate?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_workflows_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      authentication_events: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          event_type: string
          failure_reason: string | null
          fingerprint_hash: string | null
          id: string
          ip_address: unknown
          metadata: Json
          method: string | null
          occurred_at: string
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          event_type: string
          failure_reason?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          method?: string | null
          occurred_at?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          event_type?: string
          failure_reason?: string | null
          fingerprint_hash?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          method?: string | null
          occurred_at?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      authorization_decisions: {
        Row: {
          country: string | null
          created_at: string
          created_by: string | null
          decision: string
          device_id: string | null
          factors: Json
          id: string
          ip: string | null
          metadata: Json
          region_id: string | null
          required_capabilities: string[]
          resource_key: string
          resource_type: string
          risk_score: number
          tenant_id: string | null
          updated_at: string
          user_capabilities: string[]
          user_id: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          decision: string
          device_id?: string | null
          factors?: Json
          id?: string
          ip?: string | null
          metadata?: Json
          region_id?: string | null
          required_capabilities?: string[]
          resource_key: string
          resource_type: string
          risk_score?: number
          tenant_id?: string | null
          updated_at?: string
          user_capabilities?: string[]
          user_id?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string
          device_id?: string | null
          factors?: Json
          id?: string
          ip?: string | null
          metadata?: Json
          region_id?: string | null
          required_capabilities?: string[]
          resource_key?: string
          resource_type?: string
          risk_score?: number
          tenant_id?: string | null
          updated_at?: string
          user_capabilities?: string[]
          user_id?: string | null
        }
        Relationships: []
      }
      budget_consumption: {
        Row: {
          amount_cents: number
          budget_id: string
          consumed_at: string
          corporate_invoice_id: string | null
          created_at: string
          currency: string
          id: string
          journal_id: string | null
          metadata: Json
          reservation_id: string | null
        }
        Insert: {
          amount_cents: number
          budget_id: string
          consumed_at?: string
          corporate_invoice_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          reservation_id?: string | null
        }
        Update: {
          amount_cents?: number
          budget_id?: string
          consumed_at?: string
          corporate_invoice_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_consumption_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_consumption_corporate_invoice_id_fkey"
            columns: ["corporate_invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_consumption_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_consumption_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "budget_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_reservations: {
        Row: {
          amount_cents: number
          approval_request_id: string | null
          budget_id: string
          consumed_at: string | null
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          metadata: Json
          reference: string | null
          released_at: string | null
          reserved_by: string | null
          status: Database["public"]["Enums"]["budget_reservation_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          approval_request_id?: string | null
          budget_id: string
          consumed_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          reference?: string | null
          released_at?: string | null
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["budget_reservation_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          approval_request_id?: string | null
          budget_id?: string
          consumed_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          reference?: string | null
          released_at?: string | null
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["budget_reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_reservations_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          consumed_cents: number
          corporate_id: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          metadata: Json
          name: string
          notes: string | null
          period_end: string
          period_start: string
          reserved_cents: number
          status: Database["public"]["Enums"]["budget_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          consumed_cents?: number
          corporate_id: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          metadata?: Json
          name: string
          notes?: string | null
          period_end: string
          period_start: string
          reserved_cents?: number
          status?: Database["public"]["Enums"]["budget_status"]
          total_cents: number
          updated_at?: string
        }
        Update: {
          consumed_cents?: number
          corporate_id?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          metadata?: Json
          name?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          reserved_cents?: number
          status?: Database["public"]["Enums"]["budget_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      business_organisation_members: {
        Row: {
          created_at: string
          id: string
          member_role: string
          organisation_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_role?: string
          organisation_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_role?: string
          organisation_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "business_organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_organisations: {
        Row: {
          contact_email: string
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_email: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      business_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          destination: string | null
          details: string
          id: string
          organisation_id: string
          origin: string | null
          quantity: number
          requested_by: string
          requested_date: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          service_type: string
          status: string
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          destination?: string | null
          details: string
          id?: string
          organisation_id: string
          origin?: string | null
          quantity?: number
          requested_by: string
          requested_date?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_type: string
          status?: string
          updated_at?: string
          vehicle_type: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          destination?: string | null
          details?: string
          id?: string
          organisation_id?: string
          origin?: string | null
          quantity?: number
          requested_by?: string
          requested_date?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_type?: string
          status?: string
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "business_organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      capabilities: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          key: string
          metadata: Json
          name: string
          region_id: string | null
          risk_level: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key: string
          metadata?: Json
          name: string
          region_id?: string | null
          risk_level?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key?: string
          metadata?: Json
          name?: string
          region_id?: string | null
          risk_level?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      capacity_reservations: {
        Row: {
          award_id: string | null
          booking_id: string | null
          carrier_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          idempotency_key: string | null
          qty_cbm: number | null
          qty_kg: number
          released_at: string | null
          released_reason: string | null
          requirement_id: string | null
          reservation_reference: string
          slot_id: string
          state: Database["public"]["Enums"]["capacity_reservation_state"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          award_id?: string | null
          booking_id?: string | null
          carrier_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          idempotency_key?: string | null
          qty_cbm?: number | null
          qty_kg: number
          released_at?: string | null
          released_reason?: string | null
          requirement_id?: string | null
          reservation_reference: string
          slot_id: string
          state?: Database["public"]["Enums"]["capacity_reservation_state"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          award_id?: string | null
          booking_id?: string | null
          carrier_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          qty_cbm?: number | null
          qty_kg?: number
          released_at?: string | null
          released_reason?: string | null
          requirement_id?: string | null
          reservation_reference?: string
          slot_id?: string
          state?: Database["public"]["Enums"]["capacity_reservation_state"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capacity_reservations_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_reservations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "carrier_capacity_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_capacity_ledger: {
        Row: {
          actor_id: string | null
          actor_role: string
          balance_after_kg: number
          correlation_id: string | null
          created_at: string
          entry_type: string
          id: string
          idempotency_key: string | null
          qty_kg: number
          reason: string | null
          reservation_id: string | null
          slot_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string
          balance_after_kg: number
          correlation_id?: string | null
          created_at?: string
          entry_type: string
          id?: string
          idempotency_key?: string | null
          qty_kg: number
          reason?: string | null
          reservation_id?: string | null
          slot_id: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          balance_after_kg?: number
          correlation_id?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          idempotency_key?: string | null
          qty_kg?: number
          reason?: string | null
          reservation_id?: string | null
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_capacity_ledger_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "carrier_capacity_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_capacity_slots: {
        Row: {
          availability_status: Database["public"]["Enums"]["capacity_availability_state"]
          carrier_id: string
          committed_kg: number
          consumed_kg: number
          corridor: string | null
          created_at: string
          created_by: string | null
          destination_area_code: string | null
          effective_from: string
          effective_until: string
          equipment: string[]
          exclusive_vehicle: boolean
          id: string
          notes: string | null
          offered_cbm: number | null
          offered_kg: number
          origin_area_code: string | null
          reserved_kg: number
          slot_reference: string
          updated_at: string
          vehicle_class: string | null
          vehicle_id: string | null
          vehicle_type: string
        }
        Insert: {
          availability_status?: Database["public"]["Enums"]["capacity_availability_state"]
          carrier_id: string
          committed_kg?: number
          consumed_kg?: number
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          destination_area_code?: string | null
          effective_from: string
          effective_until: string
          equipment?: string[]
          exclusive_vehicle?: boolean
          id?: string
          notes?: string | null
          offered_cbm?: number | null
          offered_kg: number
          origin_area_code?: string | null
          reserved_kg?: number
          slot_reference: string
          updated_at?: string
          vehicle_class?: string | null
          vehicle_id?: string | null
          vehicle_type: string
        }
        Update: {
          availability_status?: Database["public"]["Enums"]["capacity_availability_state"]
          carrier_id?: string
          committed_kg?: number
          consumed_kg?: number
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          destination_area_code?: string | null
          effective_from?: string
          effective_until?: string
          equipment?: string[]
          exclusive_vehicle?: boolean
          id?: string
          notes?: string | null
          offered_cbm?: number | null
          offered_kg?: number
          origin_area_code?: string | null
          reserved_kg?: number
          slot_reference?: string
          updated_at?: string
          vehicle_class?: string | null
          vehicle_id?: string | null
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_capacity_slots_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_capacity_slots_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_contracts: {
        Row: {
          carrier_id: string
          contract_number: string
          contract_type: string
          created_at: string
          created_by: string | null
          currency: string
          document_id: string | null
          effective_from: string
          effective_until: string | null
          id: string
          payment_terms_days: number
          signed_by: string | null
          signed_by_carrier_at: string | null
          signed_by_yalla_at: string | null
          status: Database["public"]["Enums"]["carrier_contract_status"]
          termination_notice_days: number
          updated_at: string
        }
        Insert: {
          carrier_id: string
          contract_number: string
          contract_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          document_id?: string | null
          effective_from: string
          effective_until?: string | null
          id?: string
          payment_terms_days?: number
          signed_by?: string | null
          signed_by_carrier_at?: string | null
          signed_by_yalla_at?: string | null
          status?: Database["public"]["Enums"]["carrier_contract_status"]
          termination_notice_days?: number
          updated_at?: string
        }
        Update: {
          carrier_id?: string
          contract_number?: string
          contract_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          document_id?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          payment_terms_days?: number
          signed_by?: string | null
          signed_by_carrier_at?: string | null
          signed_by_yalla_at?: string | null
          status?: Database["public"]["Enums"]["carrier_contract_status"]
          termination_notice_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_contracts_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_payable_lines: {
        Row: {
          accrued_at: string
          accrued_by: string | null
          basis: Json
          carrier_id: string
          commission_pct: number
          created_at: string
          currency: string
          gross_amount: number
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          leg_id: string
          line_reference: string
          net_payable: number
          order_id: string
          partner_id: string
          platform_fee: number
          pod_submission_id: string
          released_at: string | null
          released_by: string | null
          state: string
          updated_at: string
        }
        Insert: {
          accrued_at?: string
          accrued_by?: string | null
          basis?: Json
          carrier_id: string
          commission_pct: number
          created_at?: string
          currency?: string
          gross_amount: number
          id?: string
          idempotency_key: string
          ledger_entry_id?: string | null
          leg_id: string
          line_reference: string
          net_payable: number
          order_id: string
          partner_id: string
          platform_fee: number
          pod_submission_id: string
          released_at?: string | null
          released_by?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          accrued_at?: string
          accrued_by?: string | null
          basis?: Json
          carrier_id?: string
          commission_pct?: number
          created_at?: string
          currency?: string
          gross_amount?: number
          id?: string
          idempotency_key?: string
          ledger_entry_id?: string | null
          leg_id?: string
          line_reference?: string
          net_payable?: number
          order_id?: string
          partner_id?: string
          platform_fee?: number
          pod_submission_id?: string
          released_at?: string | null
          released_by?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_payable_lines_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_payable_lines_leg_id_fkey"
            columns: ["leg_id"]
            isOneToOne: false
            referencedRelation: "logistics_order_legs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_payable_lines_pod_submission_id_fkey"
            columns: ["pod_submission_id"]
            isOneToOne: true
            referencedRelation: "carrier_pod_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_pod_submissions: {
        Row: {
          captured_lat: number | null
          captured_lng: number | null
          carrier_id: string
          created_at: string
          delivered_at: string
          dispatch_request_id: string | null
          evidence: Json
          id: string
          idempotency_key: string
          integrity_hash: string
          leg_id: string
          notes: string | null
          order_id: string
          recipient_id_reference: string | null
          recipient_name: string
          recipient_phone: string | null
          recipient_relationship: string | null
          rejection_reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: string
          submission_reference: string
          submitted_at: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          captured_lat?: number | null
          captured_lng?: number | null
          carrier_id: string
          created_at?: string
          delivered_at: string
          dispatch_request_id?: string | null
          evidence?: Json
          id?: string
          idempotency_key: string
          integrity_hash: string
          leg_id: string
          notes?: string | null
          order_id: string
          recipient_id_reference?: string | null
          recipient_name: string
          recipient_phone?: string | null
          recipient_relationship?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          submission_reference: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          captured_lat?: number | null
          captured_lng?: number | null
          carrier_id?: string
          created_at?: string
          delivered_at?: string
          dispatch_request_id?: string | null
          evidence?: Json
          id?: string
          idempotency_key?: string
          integrity_hash?: string
          leg_id?: string
          notes?: string | null
          order_id?: string
          recipient_id_reference?: string | null
          recipient_name?: string
          recipient_phone?: string | null
          recipient_relationship?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          submission_reference?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_pod_submissions_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_pod_submissions_dispatch_request_id_fkey"
            columns: ["dispatch_request_id"]
            isOneToOne: false
            referencedRelation: "logistics_dispatch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_pod_submissions_leg_id_fkey"
            columns: ["leg_id"]
            isOneToOne: false
            referencedRelation: "logistics_order_legs"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_profiles: {
        Row: {
          carrier_code: string
          commercial_terms: Json
          contract_reference: string | null
          contract_status: Database["public"]["Enums"]["carrier_contract_status"]
          corridors: string[]
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_until: string | null
          finance_contact_email: string | null
          finance_contact_name: string | null
          id: string
          legal_entity_name: string
          onboarding_notes: string | null
          operating_countries: string[]
          operating_status: Database["public"]["Enums"]["carrier_operating_status"]
          ops_contact_email: string | null
          ops_contact_name: string | null
          ops_contact_phone: string | null
          partner_id: string
          payment_terms_days: number
          regions: string[]
          service_categories: string[]
          settlement_currency: string
          tax_identifier: string | null
          updated_at: string
        }
        Insert: {
          carrier_code: string
          commercial_terms?: Json
          contract_reference?: string | null
          contract_status?: Database["public"]["Enums"]["carrier_contract_status"]
          corridors?: string[]
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          finance_contact_email?: string | null
          finance_contact_name?: string | null
          id?: string
          legal_entity_name: string
          onboarding_notes?: string | null
          operating_countries?: string[]
          operating_status?: Database["public"]["Enums"]["carrier_operating_status"]
          ops_contact_email?: string | null
          ops_contact_name?: string | null
          ops_contact_phone?: string | null
          partner_id: string
          payment_terms_days?: number
          regions?: string[]
          service_categories?: string[]
          settlement_currency?: string
          tax_identifier?: string | null
          updated_at?: string
        }
        Update: {
          carrier_code?: string
          commercial_terms?: Json
          contract_reference?: string | null
          contract_status?: Database["public"]["Enums"]["carrier_contract_status"]
          corridors?: string[]
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          finance_contact_email?: string | null
          finance_contact_name?: string | null
          id?: string
          legal_entity_name?: string
          onboarding_notes?: string | null
          operating_countries?: string[]
          operating_status?: Database["public"]["Enums"]["carrier_operating_status"]
          ops_contact_email?: string | null
          ops_contact_name?: string | null
          ops_contact_phone?: string | null
          partner_id?: string
          payment_terms_days?: number
          regions?: string[]
          service_categories?: string[]
          settlement_currency?: string
          tax_identifier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_profiles_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_quotations: {
        Row: {
          accepted_at: string | null
          accessorial_total: number
          accessorials: Json
          base_freight: number
          capacity_offered_kg: number
          capacity_slot_id: string | null
          carrier_id: string
          conditions: string | null
          created_at: string
          currency: string
          delivery_eta: string | null
          discount: number
          equipment: string[]
          fuel_surcharge: number
          handling_charge: number
          id: string
          loading_charge: number
          pickup_eta: string | null
          pricing_basis: Database["public"]["Enums"]["freight_pricing_basis"]
          protection_charge: number
          quote_number: string
          rate_card_version_id: string | null
          rfq_id: string
          sla_committed: string | null
          snapshot: Json | null
          snapshot_hash: string | null
          state: Database["public"]["Enums"]["carrier_quote_state"]
          storage_charge: number
          submitted_at: string | null
          submitted_by: string | null
          subtotal: number
          supersedes_id: string | null
          tax_amount: number
          toll_charge: number
          total: number
          transit_time_hours: number | null
          updated_at: string
          valid_until: string
          vehicle_type: string | null
          version: number
          waiting_charge: number
        }
        Insert: {
          accepted_at?: string | null
          accessorial_total?: number
          accessorials?: Json
          base_freight?: number
          capacity_offered_kg: number
          capacity_slot_id?: string | null
          carrier_id: string
          conditions?: string | null
          created_at?: string
          currency?: string
          delivery_eta?: string | null
          discount?: number
          equipment?: string[]
          fuel_surcharge?: number
          handling_charge?: number
          id?: string
          loading_charge?: number
          pickup_eta?: string | null
          pricing_basis?: Database["public"]["Enums"]["freight_pricing_basis"]
          protection_charge?: number
          quote_number: string
          rate_card_version_id?: string | null
          rfq_id: string
          sla_committed?: string | null
          snapshot?: Json | null
          snapshot_hash?: string | null
          state?: Database["public"]["Enums"]["carrier_quote_state"]
          storage_charge?: number
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal?: number
          supersedes_id?: string | null
          tax_amount?: number
          toll_charge?: number
          total?: number
          transit_time_hours?: number | null
          updated_at?: string
          valid_until: string
          vehicle_type?: string | null
          version?: number
          waiting_charge?: number
        }
        Update: {
          accepted_at?: string | null
          accessorial_total?: number
          accessorials?: Json
          base_freight?: number
          capacity_offered_kg?: number
          capacity_slot_id?: string | null
          carrier_id?: string
          conditions?: string | null
          created_at?: string
          currency?: string
          delivery_eta?: string | null
          discount?: number
          equipment?: string[]
          fuel_surcharge?: number
          handling_charge?: number
          id?: string
          loading_charge?: number
          pickup_eta?: string | null
          pricing_basis?: Database["public"]["Enums"]["freight_pricing_basis"]
          protection_charge?: number
          quote_number?: string
          rate_card_version_id?: string | null
          rfq_id?: string
          sla_committed?: string | null
          snapshot?: Json | null
          snapshot_hash?: string | null
          state?: Database["public"]["Enums"]["carrier_quote_state"]
          storage_charge?: number
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal?: number
          supersedes_id?: string | null
          tax_amount?: number
          toll_charge?: number
          total?: number
          transit_time_hours?: number | null
          updated_at?: string
          valid_until?: string
          vehicle_type?: string | null
          version?: number
          waiting_charge?: number
        }
        Relationships: [
          {
            foreignKeyName: "carrier_quotations_capacity_slot_id_fkey"
            columns: ["capacity_slot_id"]
            isOneToOne: false
            referencedRelation: "carrier_capacity_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_quotations_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "freight_rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_quotations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "carrier_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_rate_cards: {
        Row: {
          carrier_id: string
          contract_id: string | null
          created_at: string
          currency: string
          effective_from: string
          effective_until: string | null
          id: string
          notes: string | null
          published_at: string | null
          published_by: string | null
          rate_card_code: string
          status: string
          supersedes_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          carrier_id: string
          contract_id?: string | null
          created_at?: string
          currency?: string
          effective_from: string
          effective_until?: string | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          rate_card_code: string
          status?: string
          supersedes_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          carrier_id?: string
          contract_id?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          rate_card_code?: string
          status?: string
          supersedes_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "carrier_rate_cards_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_rate_cards_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "carrier_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_rate_cards_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "carrier_rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_rate_lines: {
        Row: {
          accessorials: Json
          break_max: number | null
          break_min: number | null
          corridor: string | null
          created_at: string
          destination_area_code: string | null
          fuel_surcharge_pct: number
          id: string
          included_units: number | null
          line_no: number
          minimum_charge: number
          origin_area_code: string | null
          pricing_basis: Database["public"]["Enums"]["freight_pricing_basis"]
          rate_card_id: string
          unit_rate: number
          vehicle_class: string | null
          waiting_rate_per_hour: number
        }
        Insert: {
          accessorials?: Json
          break_max?: number | null
          break_min?: number | null
          corridor?: string | null
          created_at?: string
          destination_area_code?: string | null
          fuel_surcharge_pct?: number
          id?: string
          included_units?: number | null
          line_no: number
          minimum_charge?: number
          origin_area_code?: string | null
          pricing_basis: Database["public"]["Enums"]["freight_pricing_basis"]
          rate_card_id: string
          unit_rate: number
          vehicle_class?: string | null
          waiting_rate_per_hour?: number
        }
        Update: {
          accessorials?: Json
          break_max?: number | null
          break_min?: number | null
          corridor?: string | null
          created_at?: string
          destination_area_code?: string | null
          fuel_surcharge_pct?: number
          id?: string
          included_units?: number | null
          line_no?: number
          minimum_charge?: number
          origin_area_code?: string | null
          pricing_basis?: Database["public"]["Enums"]["freight_pricing_basis"]
          rate_card_id?: string
          unit_rate?: number
          vehicle_class?: string | null
          waiting_rate_per_hour?: number
        }
        Relationships: [
          {
            foreignKeyName: "carrier_rate_lines_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "carrier_rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_settlement_destinations: {
        Row: {
          account_name: string
          bank_account_number: string | null
          bank_branch: string | null
          bank_name: string | null
          carrier_id: string
          created_at: string
          created_by: string | null
          currency: string
          destination_type: string
          id: string
          is_default: boolean
          msisdn: string | null
          updated_at: string
          verification_notes: string | null
          verification_state: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_name: string
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          carrier_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          destination_type: string
          id?: string
          is_default?: boolean
          msisdn?: string | null
          updated_at?: string
          verification_notes?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_name?: string
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          carrier_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          destination_type?: string
          id?: string
          is_default?: boolean
          msisdn?: string | null
          updated_at?: string
          verification_notes?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_settlement_destinations_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chargebacks: {
        Row: {
          amount_cents: number
          currency: string
          dispute_id: string | null
          id: string
          metadata: Json
          provider: string
          provider_ref: string
          received_at: string
          resolved_at: string | null
          status: string
          transaction_id: string | null
        }
        Insert: {
          amount_cents: number
          currency?: string
          dispute_id?: string | null
          id?: string
          metadata?: Json
          provider: string
          provider_ref: string
          received_at?: string
          resolved_at?: string | null
          status?: string
          transaction_id?: string | null
        }
        Update: {
          amount_cents?: number
          currency?: string
          dispute_id?: string | null
          id?: string
          metadata?: Json
          provider?: string
          provider_ref?: string
          received_at?: string
          resolved_at?: string | null
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chargebacks_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "payment_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chargebacks_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_bookings: {
        Row: {
          amount: number
          asset_name: string
          category_slug: string
          checkout_request_id: string | null
          commission_bps: number | null
          commission_cents: number | null
          contact: Json
          created_at: string
          currency: string
          financials_captured_at: string | null
          financials_source: string | null
          flight_events: Json
          flight_status: string
          id: string
          mpesa_receipt: string | null
          paid_at: string | null
          partner_entitlement_cents: number | null
          passengers: Json
          payment_method: string
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string
          quote_id: string | null
          reference: string
          status: string
          tax_cents: number | null
          trip: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount?: number
          asset_name: string
          category_slug: string
          checkout_request_id?: string | null
          commission_bps?: number | null
          commission_cents?: number | null
          contact?: Json
          created_at?: string
          currency?: string
          financials_captured_at?: string | null
          financials_source?: string | null
          flight_events?: Json
          flight_status?: string
          id?: string
          mpesa_receipt?: string | null
          paid_at?: string | null
          partner_entitlement_cents?: number | null
          passengers?: Json
          payment_method?: string
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          quote_id?: string | null
          reference: string
          status?: string
          tax_cents?: number | null
          trip?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          asset_name?: string
          category_slug?: string
          checkout_request_id?: string | null
          commission_bps?: number | null
          commission_cents?: number | null
          contact?: Json
          created_at?: string
          currency?: string
          financials_captured_at?: string | null
          financials_source?: string | null
          flight_events?: Json
          flight_status?: string
          id?: string
          mpesa_receipt?: string | null
          paid_at?: string | null
          partner_entitlement_cents?: number | null
          passengers?: Json
          payment_method?: string
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          quote_id?: string | null
          reference?: string
          status?: string
          tax_cents?: number | null
          trip?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_bookings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "charter_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_corporate_wallets: {
        Row: {
          approver_name: string | null
          approver_title: string | null
          balance_kes: number
          created_at: string
          currency: string
          id: string
          organization_name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approver_name?: string | null
          approver_title?: string | null
          balance_kes?: number
          created_at?: string
          currency?: string
          id?: string
          organization_name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approver_name?: string | null
          approver_title?: string | null
          balance_kes?: number
          created_at?: string
          currency?: string
          id?: string
          organization_name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      charter_inventory: {
        Row: {
          active: boolean
          available_from: string | null
          available_to: string | null
          base_rate: number
          capacity: string
          category_slug: string
          created_at: string
          currency: string
          home_base: string | null
          id: string
          metadata: Json
          name: string
          offer_discount_pct: number
          offer_label: string | null
          operator_id: string | null
          operator_name: string | null
          spec: string
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          base_rate: number
          capacity?: string
          category_slug: string
          created_at?: string
          currency?: string
          home_base?: string | null
          id?: string
          metadata?: Json
          name: string
          offer_discount_pct?: number
          offer_label?: string | null
          operator_id?: string | null
          operator_name?: string | null
          spec?: string
          status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          base_rate?: number
          capacity?: string
          category_slug?: string
          created_at?: string
          currency?: string
          home_base?: string | null
          id?: string
          metadata?: Json
          name?: string
          offer_discount_pct?: number
          offer_label?: string | null
          operator_id?: string | null
          operator_name?: string | null
          spec?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      charter_payment_events: {
        Row: {
          amount_kes: number | null
          applied_status: string
          booking_id: string | null
          checkout_request_id: string
          created_at: string
          dedupe_key: string
          id: string
          mpesa_receipt: string | null
          outcome: string
          payload: Json
          reference: string | null
          result_code: number | null
          result_desc: string | null
          updated_at: string
        }
        Insert: {
          amount_kes?: number | null
          applied_status: string
          booking_id?: string | null
          checkout_request_id: string
          created_at?: string
          dedupe_key: string
          id?: string
          mpesa_receipt?: string | null
          outcome?: string
          payload?: Json
          reference?: string | null
          result_code?: number | null
          result_desc?: string | null
          updated_at?: string
        }
        Update: {
          amount_kes?: number | null
          applied_status?: string
          booking_id?: string | null
          checkout_request_id?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          mpesa_receipt?: string | null
          outcome?: string
          payload?: Json
          reference?: string | null
          result_code?: number | null
          result_desc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charter_payment_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "charter_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_quotes: {
        Row: {
          asset_name: string
          breakdown: Json
          category_slug: string
          contact: Json
          controls: Json
          cost_settings: Json
          created_at: string
          currency: string
          duration: number
          id: string
          inventory_id: string | null
          pricing_version: number
          quantity: number
          reference: string
          rfq_state: string | null
          rfq_state_at: string | null
          status: string
          total: number
          trip: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          asset_name: string
          breakdown?: Json
          category_slug: string
          contact?: Json
          controls?: Json
          cost_settings?: Json
          created_at?: string
          currency?: string
          duration: number
          id?: string
          inventory_id?: string | null
          pricing_version?: number
          quantity?: number
          reference: string
          rfq_state?: string | null
          rfq_state_at?: string | null
          status?: string
          total?: number
          trip?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          asset_name?: string
          breakdown?: Json
          category_slug?: string
          contact?: Json
          controls?: Json
          cost_settings?: Json
          created_at?: string
          currency?: string
          duration?: number
          id?: string
          inventory_id?: string | null
          pricing_version?: number
          quantity?: number
          reference?: string
          rfq_state?: string | null
          rfq_state_at?: string | null
          status?: string
          total?: number
          trip?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_quotes_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "charter_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_alert_delivery_attempts: {
        Row: {
          alert_id: string
          attempt: number
          channel: string
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          next_attempt_at: string | null
          ok: boolean
          status_code: number | null
          target: string | null
        }
        Insert: {
          alert_id: string
          attempt: number
          channel: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          next_attempt_at?: string | null
          ok?: boolean
          status_code?: number | null
          target?: string | null
        }
        Update: {
          alert_id?: string
          attempt?: number
          channel?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          next_attempt_at?: string | null
          ok?: boolean
          status_code?: number | null
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_alert_delivery_attempts_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "charter_wallet_finance_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_finance_actions: {
        Row: {
          action: string
          actor_id: string | null
          amount_kes: number | null
          created_at: string
          evidence: Json
          funding_request_id: string | null
          id: string
          ledger_entry_id: string | null
          reason: string
          wallet_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          amount_kes?: number | null
          created_at?: string
          evidence?: Json
          funding_request_id?: string | null
          id?: string
          ledger_entry_id?: string | null
          reason: string
          wallet_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          amount_kes?: number | null
          created_at?: string
          evidence?: Json
          funding_request_id?: string | null
          id?: string
          ledger_entry_id?: string | null
          reason?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_finance_actions_funding_request_id_fkey"
            columns: ["funding_request_id"]
            isOneToOne: false
            referencedRelation: "charter_wallet_funding_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charter_wallet_finance_actions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "charter_corporate_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_finance_alert_settings: {
        Row: {
          backoff_base_seconds: number
          backoff_max_seconds: number
          created_at: string
          email_recipients: string[]
          enabled: boolean
          id: string
          max_attempts: number
          min_severity: string
          singleton: boolean
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          backoff_base_seconds?: number
          backoff_max_seconds?: number
          created_at?: string
          email_recipients?: string[]
          enabled?: boolean
          id?: string
          max_attempts?: number
          min_severity?: string
          singleton?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          backoff_base_seconds?: number
          backoff_max_seconds?: number
          created_at?: string
          email_recipients?: string[]
          enabled?: boolean
          id?: string
          max_attempts?: number
          min_severity?: string
          singleton?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      charter_wallet_finance_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_notes: string | null
          actual_kes: number | null
          attempts: number
          created_at: string
          detail: string
          email_sent_to: string[]
          expected_kes: number | null
          finding_id: string
          funding_request_id: string | null
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string | null
          notified_at: string | null
          run_id: string | null
          severity: string
          status: string
          wallet_id: string | null
          webhook_status: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          actual_kes?: number | null
          attempts?: number
          created_at?: string
          detail: string
          email_sent_to?: string[]
          expected_kes?: number | null
          finding_id: string
          funding_request_id?: string | null
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          notified_at?: string | null
          run_id?: string | null
          severity: string
          status?: string
          wallet_id?: string | null
          webhook_status?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          actual_kes?: number | null
          attempts?: number
          created_at?: string
          detail?: string
          email_sent_to?: string[]
          expected_kes?: number | null
          finding_id?: string
          funding_request_id?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          notified_at?: string | null
          run_id?: string | null
          severity?: string
          status?: string
          wallet_id?: string | null
          webhook_status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_finance_alerts_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: true
            referencedRelation: "charter_wallet_reconciliation_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charter_wallet_finance_alerts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "charter_wallet_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_funding_limits: {
        Row: {
          actor_id: string | null
          approval_threshold_kes: number
          created_at: string
          daily_max_kes: number
          department: string | null
          id: string
          label: string | null
          monthly_max_kes: number
          per_txn_max_kes: number
          updated_at: string
          wallet_id: string | null
        }
        Insert: {
          actor_id?: string | null
          approval_threshold_kes?: number
          created_at?: string
          daily_max_kes?: number
          department?: string | null
          id?: string
          label?: string | null
          monthly_max_kes?: number
          per_txn_max_kes?: number
          updated_at?: string
          wallet_id?: string | null
        }
        Update: {
          actor_id?: string | null
          approval_threshold_kes?: number
          created_at?: string
          daily_max_kes?: number
          department?: string | null
          id?: string
          label?: string | null
          monthly_max_kes?: number
          per_txn_max_kes?: number
          updated_at?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_funding_limits_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "charter_corporate_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_funding_requests: {
        Row: {
          actor_id: string | null
          amount_kes: number
          approver_name: string | null
          approver_title: string | null
          checkout_request_id: string | null
          cost_center: string
          created_at: string
          department: string | null
          expires_at: string
          id: string
          idempotency_key: string
          last_stk_at: string | null
          ledger_entry_id: string | null
          merchant_request_id: string | null
          mpesa_receipt: string | null
          owner_id: string
          paid_at: string | null
          phone: string | null
          purpose: string | null
          reference: string
          requires_approval: boolean
          result_code: number | null
          result_desc: string | null
          reversal_evidence: Json | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
          stk_attempts: number
          updated_at: string
          wallet_id: string
        }
        Insert: {
          actor_id?: string | null
          amount_kes: number
          approver_name?: string | null
          approver_title?: string | null
          checkout_request_id?: string | null
          cost_center: string
          created_at?: string
          department?: string | null
          expires_at?: string
          id?: string
          idempotency_key: string
          last_stk_at?: string | null
          ledger_entry_id?: string | null
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          owner_id: string
          paid_at?: string | null
          phone?: string | null
          purpose?: string | null
          reference: string
          requires_approval?: boolean
          result_code?: number | null
          result_desc?: string | null
          reversal_evidence?: Json | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          stk_attempts?: number
          updated_at?: string
          wallet_id: string
        }
        Update: {
          actor_id?: string | null
          amount_kes?: number
          approver_name?: string | null
          approver_title?: string | null
          checkout_request_id?: string | null
          cost_center?: string
          created_at?: string
          department?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          last_stk_at?: string | null
          ledger_entry_id?: string | null
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          owner_id?: string
          paid_at?: string | null
          phone?: string | null
          purpose?: string | null
          reference?: string
          requires_approval?: boolean
          result_code?: number | null
          result_desc?: string | null
          reversal_evidence?: Json | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          stk_attempts?: number
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_funding_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "charter_corporate_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_ledger: {
        Row: {
          actor_id: string | null
          amount_kes: number
          approver_name: string | null
          approver_title: string | null
          balance_after: number
          booking_id: string | null
          cost_center: string | null
          created_at: string
          direction: string
          entry_hash: string
          id: string
          prev_hash: string | null
          reference: string | null
          wallet_id: string
        }
        Insert: {
          actor_id?: string | null
          amount_kes: number
          approver_name?: string | null
          approver_title?: string | null
          balance_after: number
          booking_id?: string | null
          cost_center?: string | null
          created_at?: string
          direction: string
          entry_hash: string
          id?: string
          prev_hash?: string | null
          reference?: string | null
          wallet_id: string
        }
        Update: {
          actor_id?: string | null
          amount_kes?: number
          approver_name?: string | null
          approver_title?: string | null
          balance_after?: number
          booking_id?: string | null
          cost_center?: string | null
          created_at?: string
          direction?: string
          entry_hash?: string
          id?: string
          prev_hash?: string | null
          reference?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_ledger_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "charter_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charter_wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "charter_corporate_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_reconciliation_attempts: {
        Row: {
          attempt: number
          created_at: string
          critical: number
          error: string | null
          findings: number
          finished_at: string | null
          id: string
          note: string | null
          requested_by: string | null
          requested_from: string
          requested_to: string
          retry_of: string | null
          run_id: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          critical?: number
          error?: string | null
          findings?: number
          finished_at?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          requested_from: string
          requested_to: string
          retry_of?: string | null
          run_id?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt?: number
          created_at?: string
          critical?: number
          error?: string | null
          findings?: number
          finished_at?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          requested_from?: string
          requested_to?: string
          retry_of?: string | null
          run_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_reconciliation_attempts_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "charter_wallet_reconciliation_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charter_wallet_reconciliation_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "charter_wallet_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_reconciliation_findings: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_kes: number | null
          created_at: string
          detail: string
          expected_kes: number | null
          funding_request_id: string | null
          id: string
          kind: string
          resolution_notes: string | null
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          run_id: string
          severity: string
          wallet_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_kes?: number | null
          created_at?: string
          detail: string
          expected_kes?: number | null
          funding_request_id?: string | null
          id?: string
          kind: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          run_id: string
          severity: string
          wallet_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_kes?: number | null
          created_at?: string
          detail?: string
          expected_kes?: number | null
          funding_request_id?: string | null
          id?: string
          kind?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          run_id?: string
          severity?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charter_wallet_reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "charter_wallet_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      charter_wallet_reconciliation_runs: {
        Row: {
          balanced: boolean
          created_at: string
          critical: number
          findings: number
          id: string
          requests_scanned: number
          triggered_by: string
          wallets_scanned: number
          window_end: string
          window_start: string
        }
        Insert: {
          balanced?: boolean
          created_at?: string
          critical?: number
          findings?: number
          id?: string
          requests_scanned?: number
          triggered_by?: string
          wallets_scanned?: number
          window_end: string
          window_start: string
        }
        Update: {
          balanced?: boolean
          created_at?: string
          critical?: number
          findings?: number
          id?: string
          requests_scanned?: number
          triggered_by?: string
          wallets_scanned?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      commercial_actions: {
        Row: {
          action_ref: string
          approval_required: boolean
          approved_at: string | null
          approved_by: string | null
          authority_class: string
          booking_id: string | null
          booking_table: string | null
          closed_at: string | null
          confidence_pct: number | null
          created_at: string
          created_by: string | null
          customer_ref: string | null
          dispatch_request_id: string | null
          executed_at: string | null
          expected_contribution_cents: number | null
          expected_conversion_pct: number | null
          expected_revenue_cents: number | null
          id: string
          invoice_id: string | null
          lineage: Json
          opportunity_ref: string | null
          owner_label: string | null
          owner_user_id: string | null
          payment_id: string | null
          provenance: string
          quote_id: string | null
          recommendation: string
          revenue_event_id: string | null
          risk_class: string
          settlement_id: string | null
          signal_evidence: Json
          signal_kind: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_ref?: string
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          authority_class?: string
          booking_id?: string | null
          booking_table?: string | null
          closed_at?: string | null
          confidence_pct?: number | null
          created_at?: string
          created_by?: string | null
          customer_ref?: string | null
          dispatch_request_id?: string | null
          executed_at?: string | null
          expected_contribution_cents?: number | null
          expected_conversion_pct?: number | null
          expected_revenue_cents?: number | null
          id?: string
          invoice_id?: string | null
          lineage?: Json
          opportunity_ref?: string | null
          owner_label?: string | null
          owner_user_id?: string | null
          payment_id?: string | null
          provenance?: string
          quote_id?: string | null
          recommendation: string
          revenue_event_id?: string | null
          risk_class?: string
          settlement_id?: string | null
          signal_evidence?: Json
          signal_kind: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_ref?: string
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          authority_class?: string
          booking_id?: string | null
          booking_table?: string | null
          closed_at?: string | null
          confidence_pct?: number | null
          created_at?: string
          created_by?: string | null
          customer_ref?: string | null
          dispatch_request_id?: string | null
          executed_at?: string | null
          expected_contribution_cents?: number | null
          expected_conversion_pct?: number | null
          expected_revenue_cents?: number | null
          id?: string
          invoice_id?: string | null
          lineage?: Json
          opportunity_ref?: string | null
          owner_label?: string | null
          owner_user_id?: string | null
          payment_id?: string | null
          provenance?: string
          quote_id?: string | null
          recommendation?: string
          revenue_event_id?: string | null
          risk_class?: string
          settlement_id?: string | null
          signal_evidence?: Json
          signal_kind?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      commercial_opportunities: {
        Row: {
          corporate_id: string | null
          created_at: string
          currency: string
          customer_kind: string
          customer_label: string | null
          customer_user_id: string | null
          expected_value_cents: number | null
          id: string
          lost_reason: string | null
          opportunity_ref: string
          owner_user_id: string | null
          probability_pct: number | null
          provenance: string
          quote_id: string | null
          source: string
          source_ref: string | null
          stage: string
          title: string
          updated_at: string
        }
        Insert: {
          corporate_id?: string | null
          created_at?: string
          currency?: string
          customer_kind?: string
          customer_label?: string | null
          customer_user_id?: string | null
          expected_value_cents?: number | null
          id?: string
          lost_reason?: string | null
          opportunity_ref: string
          owner_user_id?: string | null
          probability_pct?: number | null
          provenance?: string
          quote_id?: string | null
          source?: string
          source_ref?: string | null
          stage?: string
          title: string
          updated_at?: string
        }
        Update: {
          corporate_id?: string | null
          created_at?: string
          currency?: string
          customer_kind?: string
          customer_label?: string | null
          customer_user_id?: string | null
          expected_value_cents?: number | null
          id?: string
          lost_reason?: string | null
          opportunity_ref?: string
          owner_user_id?: string | null
          probability_pct?: number | null
          provenance?: string
          quote_id?: string | null
          source?: string
          source_ref?: string | null
          stage?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      commercial_transactions: {
        Row: {
          accepted_at: string | null
          adjustment_cents: number
          booked_at: string | null
          booking_id: string | null
          booking_table: string | null
          cancelled_at: string | null
          commercial_action_id: string | null
          commitment_id: string | null
          committed_at: string | null
          contribution_cents: number | null
          corporate_id: string | null
          created_at: string
          currency: string
          customer_charge_cents: number | null
          customer_kind: string
          customer_user_id: string | null
          demand_intent_ref: string | null
          dispatch_assignment_id: string | null
          driver_id: string | null
          economics_complete: boolean
          eligibility_reason: string | null
          financial_auto_approved: boolean
          financial_confidence: number | null
          financial_confidence_factors: Json | null
          financial_review_notes: string | null
          financial_review_status: string
          financial_reviewed_at: string | null
          financial_reviewed_by: string | null
          financially_eligible: boolean
          financials_source: string | null
          fulfilled_at: string | null
          fulfilment_source: string | null
          gross_transaction_value_cents: number | null
          id: string
          incentive_cents: number
          integrity_flags: Json
          invoice_id: string | null
          invoice_table: string | null
          lineage: Json
          missing_fields: Json
          offer_ref: string | null
          opportunity_id: string | null
          origin_path: string
          paid_at: string | null
          partner_entitlement_cents: number | null
          payment_cost_cents: number
          payment_evidence_kind: string | null
          payment_id: string | null
          payment_provider: string | null
          payment_ref: string | null
          payment_status: string | null
          payment_table: string | null
          platform_revenue_cents: number | null
          provenance: string
          provider_kind: string | null
          provider_ref: string | null
          quote_id: string | null
          recognised_at: string | null
          refund_cents: number
          revenue_event_id: string | null
          service_line: string
          settlement_id: string | null
          status: string
          tax_cents: number
          transaction_ref: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          adjustment_cents?: number
          booked_at?: string | null
          booking_id?: string | null
          booking_table?: string | null
          cancelled_at?: string | null
          commercial_action_id?: string | null
          commitment_id?: string | null
          committed_at?: string | null
          contribution_cents?: number | null
          corporate_id?: string | null
          created_at?: string
          currency?: string
          customer_charge_cents?: number | null
          customer_kind?: string
          customer_user_id?: string | null
          demand_intent_ref?: string | null
          dispatch_assignment_id?: string | null
          driver_id?: string | null
          economics_complete?: boolean
          eligibility_reason?: string | null
          financial_auto_approved?: boolean
          financial_confidence?: number | null
          financial_confidence_factors?: Json | null
          financial_review_notes?: string | null
          financial_review_status?: string
          financial_reviewed_at?: string | null
          financial_reviewed_by?: string | null
          financially_eligible?: boolean
          financials_source?: string | null
          fulfilled_at?: string | null
          fulfilment_source?: string | null
          gross_transaction_value_cents?: number | null
          id?: string
          incentive_cents?: number
          integrity_flags?: Json
          invoice_id?: string | null
          invoice_table?: string | null
          lineage?: Json
          missing_fields?: Json
          offer_ref?: string | null
          opportunity_id?: string | null
          origin_path?: string
          paid_at?: string | null
          partner_entitlement_cents?: number | null
          payment_cost_cents?: number
          payment_evidence_kind?: string | null
          payment_id?: string | null
          payment_provider?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          payment_table?: string | null
          platform_revenue_cents?: number | null
          provenance?: string
          provider_kind?: string | null
          provider_ref?: string | null
          quote_id?: string | null
          recognised_at?: string | null
          refund_cents?: number
          revenue_event_id?: string | null
          service_line: string
          settlement_id?: string | null
          status?: string
          tax_cents?: number
          transaction_ref?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          adjustment_cents?: number
          booked_at?: string | null
          booking_id?: string | null
          booking_table?: string | null
          cancelled_at?: string | null
          commercial_action_id?: string | null
          commitment_id?: string | null
          committed_at?: string | null
          contribution_cents?: number | null
          corporate_id?: string | null
          created_at?: string
          currency?: string
          customer_charge_cents?: number | null
          customer_kind?: string
          customer_user_id?: string | null
          demand_intent_ref?: string | null
          dispatch_assignment_id?: string | null
          driver_id?: string | null
          economics_complete?: boolean
          eligibility_reason?: string | null
          financial_auto_approved?: boolean
          financial_confidence?: number | null
          financial_confidence_factors?: Json | null
          financial_review_notes?: string | null
          financial_review_status?: string
          financial_reviewed_at?: string | null
          financial_reviewed_by?: string | null
          financially_eligible?: boolean
          financials_source?: string | null
          fulfilled_at?: string | null
          fulfilment_source?: string | null
          gross_transaction_value_cents?: number | null
          id?: string
          incentive_cents?: number
          integrity_flags?: Json
          invoice_id?: string | null
          invoice_table?: string | null
          lineage?: Json
          missing_fields?: Json
          offer_ref?: string | null
          opportunity_id?: string | null
          origin_path?: string
          paid_at?: string | null
          partner_entitlement_cents?: number | null
          payment_cost_cents?: number
          payment_evidence_kind?: string | null
          payment_id?: string | null
          payment_provider?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          payment_table?: string | null
          platform_revenue_cents?: number | null
          provenance?: string
          provider_kind?: string | null
          provider_ref?: string | null
          quote_id?: string | null
          recognised_at?: string | null
          refund_cents?: number
          revenue_event_id?: string | null
          service_line?: string
          settlement_id?: string | null
          status?: string
          tax_cents?: number
          transaction_ref?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_transactions_commercial_action_id_fkey"
            columns: ["commercial_action_id"]
            isOneToOne: false
            referencedRelation: "commercial_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_transactions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "commercial_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_accounts: {
        Row: {
          billing_address: string | null
          billing_email: string
          billing_phone: string | null
          created_at: string
          credit_limit_cents: number
          currency: string
          id: string
          kra_pin: string
          legal_name: string
          metadata: Json
          paybill_reference: string | null
          payment_terms_days: number
          registration_number: string | null
          status: Database["public"]["Enums"]["corporate_status"]
          trading_name: string | null
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          billing_email: string
          billing_phone?: string | null
          created_at?: string
          credit_limit_cents?: number
          currency?: string
          id?: string
          kra_pin: string
          legal_name: string
          metadata?: Json
          paybill_reference?: string | null
          payment_terms_days?: number
          registration_number?: string | null
          status?: Database["public"]["Enums"]["corporate_status"]
          trading_name?: string | null
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          billing_email?: string
          billing_phone?: string | null
          created_at?: string
          credit_limit_cents?: number
          currency?: string
          id?: string
          kra_pin?: string
          legal_name?: string
          metadata?: Json
          paybill_reference?: string | null
          payment_terms_days?: number
          registration_number?: string | null
          status?: Database["public"]["Enums"]["corporate_status"]
          trading_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      corporate_bank_guarantees: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          approved_at: string | null
          approved_by: string | null
          beneficiary: string
          claim_expiry_date: string | null
          corporate_id: string
          created_at: string
          created_by: string | null
          currency: string
          document_reference: string | null
          document_sha256: string | null
          document_storage_path: string | null
          effective_date: string
          expired_at: string | null
          expiry_date: string
          external_verification_required: boolean
          guarantee_number: string
          guaranteed_amount_cents: number
          id: string
          issue_date: string
          issuing_bank: string
          legal_entity_name: string
          rejection_reason: string | null
          revoked_at: string | null
          state: Database["public"]["Enums"]["bank_guarantee_state"]
          suspended_at: string | null
          updated_at: string
          verification_note: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          beneficiary?: string
          claim_expiry_date?: string | null
          corporate_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          document_reference?: string | null
          document_sha256?: string | null
          document_storage_path?: string | null
          effective_date: string
          expired_at?: string | null
          expiry_date: string
          external_verification_required?: boolean
          guarantee_number: string
          guaranteed_amount_cents: number
          id?: string
          issue_date: string
          issuing_bank: string
          legal_entity_name: string
          rejection_reason?: string | null
          revoked_at?: string | null
          state?: Database["public"]["Enums"]["bank_guarantee_state"]
          suspended_at?: string | null
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          beneficiary?: string
          claim_expiry_date?: string | null
          corporate_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          document_reference?: string | null
          document_sha256?: string | null
          document_storage_path?: string | null
          effective_date?: string
          expired_at?: string | null
          expiry_date?: string
          external_verification_required?: boolean
          guarantee_number?: string
          guaranteed_amount_cents?: number
          id?: string
          issue_date?: string
          issuing_bank?: string
          legal_entity_name?: string
          rejection_reason?: string | null
          revoked_at?: string | null
          state?: Database["public"]["Enums"]["bank_guarantee_state"]
          suspended_at?: string | null
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_bank_guarantees_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_billing_periods: {
        Row: {
          billed_at: string | null
          corporate_id: string
          created_at: string
          id: string
          locked_at: string | null
          metadata: Json
          period_end: string
          period_start: string
          settled_at: string | null
          status: Database["public"]["Enums"]["corporate_period_status"]
          updated_at: string
        }
        Insert: {
          billed_at?: string | null
          corporate_id: string
          created_at?: string
          id?: string
          locked_at?: string | null
          metadata?: Json
          period_end: string
          period_start: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["corporate_period_status"]
          updated_at?: string
        }
        Update: {
          billed_at?: string | null
          corporate_id?: string
          created_at?: string
          id?: string
          locked_at?: string | null
          metadata?: Json
          period_end?: string
          period_start?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["corporate_period_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_billing_periods_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_cash_ledger: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          corporate_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          entry_type: Database["public"]["Enums"]["corp_ledger_entry_type"]
          id: string
          metadata: Json
          occurred_at: string
          reference: string | null
          source_id: string | null
          source_kind: string | null
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          corporate_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entry_type: Database["public"]["Enums"]["corp_ledger_entry_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          reference?: string | null
          source_id?: string | null
          source_kind?: string | null
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          corporate_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entry_type?: Database["public"]["Enums"]["corp_ledger_entry_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          reference?: string | null
          source_id?: string | null
          source_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_cash_ledger_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_cash_ledger_audit: {
        Row: {
          actor_email: string | null
          actor_user_id: string | null
          amount_cents: number | null
          balance_after_cents: number | null
          corporate_id: string
          created_at: string
          event_type: string
          id: string
          ledger_entry_id: string | null
          notes: string | null
          paybill_reference: string | null
          payload: Json
          proof_id: string | null
          reference: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_user_id?: string | null
          amount_cents?: number | null
          balance_after_cents?: number | null
          corporate_id: string
          created_at?: string
          event_type: string
          id?: string
          ledger_entry_id?: string | null
          notes?: string | null
          paybill_reference?: string | null
          payload?: Json
          proof_id?: string | null
          reference?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_user_id?: string | null
          amount_cents?: number | null
          balance_after_cents?: number | null
          corporate_id?: string
          created_at?: string
          event_type?: string
          id?: string
          ledger_entry_id?: string | null
          notes?: string | null
          paybill_reference?: string | null
          payload?: Json
          proof_id?: string | null
          reference?: string | null
        }
        Relationships: []
      }
      corporate_credit_facilities: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          approved_at: string | null
          approved_by: string | null
          approved_credit_limit_cents: number
          corporate_id: string
          created_at: string
          currency: string
          daily_exposure_cents: number | null
          effective_date: string
          expiry_date: string
          guarantee_id: string
          id: string
          max_transaction_cents: number | null
          monthly_exposure_cents: number | null
          policy_reference: string | null
          risk_margin_bps: number
          state: Database["public"]["Enums"]["credit_facility_state"]
          updated_at: string
          utilized_credit_cents: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_credit_limit_cents: number
          corporate_id: string
          created_at?: string
          currency?: string
          daily_exposure_cents?: number | null
          effective_date: string
          expiry_date: string
          guarantee_id: string
          id?: string
          max_transaction_cents?: number | null
          monthly_exposure_cents?: number | null
          policy_reference?: string | null
          risk_margin_bps?: number
          state?: Database["public"]["Enums"]["credit_facility_state"]
          updated_at?: string
          utilized_credit_cents?: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_credit_limit_cents?: number
          corporate_id?: string
          created_at?: string
          currency?: string
          daily_exposure_cents?: number | null
          effective_date?: string
          expiry_date?: string
          guarantee_id?: string
          id?: string
          max_transaction_cents?: number | null
          monthly_exposure_cents?: number | null
          policy_reference?: string | null
          risk_margin_bps?: number
          state?: Database["public"]["Enums"]["credit_facility_state"]
          updated_at?: string
          utilized_credit_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "corporate_credit_facilities_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_credit_facilities_guarantee_id_fkey"
            columns: ["guarantee_id"]
            isOneToOne: false
            referencedRelation: "corporate_bank_guarantees"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_credit_reservations: {
        Row: {
          amount_cents: number
          booking_id: string | null
          corporate_id: string
          correlation_id: string | null
          created_at: string
          currency: string
          facility_id: string
          final_amount_cents: number | null
          guarantee_id: string
          id: string
          idempotency_key: string
          released_at: string | null
          requested_by: string | null
          state: Database["public"]["Enums"]["credit_reservation_state"]
          trip_request_id: string | null
          updated_at: string
          utilized_at: string | null
        }
        Insert: {
          amount_cents: number
          booking_id?: string | null
          corporate_id: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          facility_id: string
          final_amount_cents?: number | null
          guarantee_id: string
          id?: string
          idempotency_key: string
          released_at?: string | null
          requested_by?: string | null
          state?: Database["public"]["Enums"]["credit_reservation_state"]
          trip_request_id?: string | null
          updated_at?: string
          utilized_at?: string | null
        }
        Update: {
          amount_cents?: number
          booking_id?: string | null
          corporate_id?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          facility_id?: string
          final_amount_cents?: number | null
          guarantee_id?: string
          id?: string
          idempotency_key?: string
          released_at?: string | null
          requested_by?: string | null
          state?: Database["public"]["Enums"]["credit_reservation_state"]
          trip_request_id?: string | null
          updated_at?: string
          utilized_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_credit_reservations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "corporate_credit_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_credit_reservations_guarantee_id_fkey"
            columns: ["guarantee_id"]
            isOneToOne: false
            referencedRelation: "corporate_bank_guarantees"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_financial_reconciliation: {
        Row: {
          amount_difference_cents: number
          cash_ledger_amount_cents: number | null
          cash_posting_status: string | null
          confidence_score: number
          corp_reference: string
          corporate_id: string
          created_at: string
          duplicate_receipt: boolean
          expected_amount_cents: number
          id: string
          investigated: boolean
          investigation_started_at: string | null
          last_reconciled_at: string | null
          ledger_posted: boolean
          metadata: Json
          mismatch_reason: string | null
          mpesa_receipt: string | null
          proof_amount_cents: number | null
          proof_exists: boolean
          proof_id: string | null
          proof_reference: string | null
          proof_status: string | null
          reconciliation_status: Database["public"]["Enums"]["reconciliation_status_enum"]
          severity: Database["public"]["Enums"]["reconciliation_severity"]
          updated_at: string
          wallet_amount_cents: number | null
          wallet_posted: boolean
          wallet_status: string | null
        }
        Insert: {
          amount_difference_cents?: number
          cash_ledger_amount_cents?: number | null
          cash_posting_status?: string | null
          confidence_score?: number
          corp_reference: string
          corporate_id: string
          created_at?: string
          duplicate_receipt?: boolean
          expected_amount_cents?: number
          id?: string
          investigated?: boolean
          investigation_started_at?: string | null
          last_reconciled_at?: string | null
          ledger_posted?: boolean
          metadata?: Json
          mismatch_reason?: string | null
          mpesa_receipt?: string | null
          proof_amount_cents?: number | null
          proof_exists?: boolean
          proof_id?: string | null
          proof_reference?: string | null
          proof_status?: string | null
          reconciliation_status?: Database["public"]["Enums"]["reconciliation_status_enum"]
          severity?: Database["public"]["Enums"]["reconciliation_severity"]
          updated_at?: string
          wallet_amount_cents?: number | null
          wallet_posted?: boolean
          wallet_status?: string | null
        }
        Update: {
          amount_difference_cents?: number
          cash_ledger_amount_cents?: number | null
          cash_posting_status?: string | null
          confidence_score?: number
          corp_reference?: string
          corporate_id?: string
          created_at?: string
          duplicate_receipt?: boolean
          expected_amount_cents?: number
          id?: string
          investigated?: boolean
          investigation_started_at?: string | null
          last_reconciled_at?: string | null
          ledger_posted?: boolean
          metadata?: Json
          mismatch_reason?: string | null
          mpesa_receipt?: string | null
          proof_amount_cents?: number | null
          proof_exists?: boolean
          proof_id?: string | null
          proof_reference?: string | null
          proof_status?: string | null
          reconciliation_status?: Database["public"]["Enums"]["reconciliation_status_enum"]
          severity?: Database["public"]["Enums"]["reconciliation_severity"]
          updated_at?: string
          wallet_amount_cents?: number | null
          wallet_posted?: boolean
          wallet_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_financial_reconciliation_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_invoice_adjustments: {
        Row: {
          amount_cents: number
          applied_by: string | null
          created_at: string
          id: string
          invoice_id: string
          journal_id: string | null
          kind: string
          metadata: Json
          reason: string
        }
        Insert: {
          amount_cents: number
          applied_by?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          journal_id?: string | null
          kind: string
          metadata?: Json
          reason: string
        }
        Update: {
          amount_cents?: number
          applied_by?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          journal_id?: string | null
          kind?: string
          metadata?: Json
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_invoice_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_invoice_adjustments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_invoice_items: {
        Row: {
          cost_center: string | null
          created_at: string
          department: string | null
          description: string
          employee_name: string | null
          employee_user_id: string | null
          id: string
          invoice_id: string
          line_number: number
          metadata: Json
          policy_code: string | null
          quantity: number
          revenue_event_id: string | null
          source_ref: string | null
          tax_cents: number
          taxable_cents: number
          total_cents: number
          trip_destination: string | null
          trip_ended_at: string | null
          trip_origin: string | null
          trip_started_at: string | null
          unit_price_cents: number
        }
        Insert: {
          cost_center?: string | null
          created_at?: string
          department?: string | null
          description: string
          employee_name?: string | null
          employee_user_id?: string | null
          id?: string
          invoice_id: string
          line_number: number
          metadata?: Json
          policy_code?: string | null
          quantity?: number
          revenue_event_id?: string | null
          source_ref?: string | null
          tax_cents: number
          taxable_cents: number
          total_cents: number
          trip_destination?: string | null
          trip_ended_at?: string | null
          trip_origin?: string | null
          trip_started_at?: string | null
          unit_price_cents: number
        }
        Update: {
          cost_center?: string | null
          created_at?: string
          department?: string | null
          description?: string
          employee_name?: string | null
          employee_user_id?: string | null
          id?: string
          invoice_id?: string
          line_number?: number
          metadata?: Json
          policy_code?: string | null
          quantity?: number
          revenue_event_id?: string | null
          source_ref?: string | null
          tax_cents?: number
          taxable_cents?: number
          total_cents?: number
          trip_destination?: string | null
          trip_ended_at?: string | null
          trip_origin?: string | null
          trip_started_at?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "corporate_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_invoice_items_revenue_event_id_fkey"
            columns: ["revenue_event_id"]
            isOneToOne: false
            referencedRelation: "revenue_events"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_invoice_taxes: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          tax_cents: number
          tax_rate_bps: number
          tax_scheme_code: string
          taxable_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          tax_cents: number
          tax_rate_bps: number
          tax_scheme_code: string
          taxable_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          tax_cents?: number
          tax_rate_bps?: number
          tax_scheme_code?: string
          taxable_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "corporate_invoice_taxes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_invoices: {
        Row: {
          adjustments_cents: number
          balance_cents: number
          corporate_id: string
          created_at: string
          currency: string
          due_at: string
          etims_invoice_id: string | null
          id: string
          invoice_number: string
          issued_at: string
          journal_id: string | null
          metadata: Json
          paid_at: string | null
          paid_cents: number
          period_id: string
          status: Database["public"]["Enums"]["corporate_invoice_status"]
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          adjustments_cents?: number
          balance_cents: number
          corporate_id: string
          created_at?: string
          currency?: string
          due_at: string
          etims_invoice_id?: string | null
          id?: string
          invoice_number: string
          issued_at?: string
          journal_id?: string | null
          metadata?: Json
          paid_at?: string | null
          paid_cents?: number
          period_id: string
          status?: Database["public"]["Enums"]["corporate_invoice_status"]
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at?: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          adjustments_cents?: number
          balance_cents?: number
          corporate_id?: string
          created_at?: string
          currency?: string
          due_at?: string
          etims_invoice_id?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string
          journal_id?: string | null
          metadata?: Json
          paid_at?: string | null
          paid_cents?: number
          period_id?: string
          status?: Database["public"]["Enums"]["corporate_invoice_status"]
          subtotal_cents?: number
          tax_total_cents?: number
          total_cents?: number
          updated_at?: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_invoices_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_invoices_etims_invoice_id_fkey"
            columns: ["etims_invoice_id"]
            isOneToOne: false
            referencedRelation: "etims_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_invoices_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_invoices_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "corporate_billing_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_payment_decisions: {
        Row: {
          actor_id: string | null
          available_credit_cents: number | null
          corporate_id: string
          correlation_id: string | null
          created_at: string
          decision: Database["public"]["Enums"]["payment_decision_type"]
          detail: Json
          facility_id: string | null
          guarantee_id: string | null
          id: string
          policy_id: string | null
          policy_version: number | null
          reason_codes: string[]
          requested_amount_cents: number
          requested_mode: Database["public"]["Enums"]["yalla_payment_mode"]
        }
        Insert: {
          actor_id?: string | null
          available_credit_cents?: number | null
          corporate_id: string
          correlation_id?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["payment_decision_type"]
          detail?: Json
          facility_id?: string | null
          guarantee_id?: string | null
          id?: string
          policy_id?: string | null
          policy_version?: number | null
          reason_codes?: string[]
          requested_amount_cents: number
          requested_mode: Database["public"]["Enums"]["yalla_payment_mode"]
        }
        Update: {
          actor_id?: string | null
          available_credit_cents?: number | null
          corporate_id?: string
          correlation_id?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["payment_decision_type"]
          detail?: Json
          facility_id?: string | null
          guarantee_id?: string | null
          id?: string
          policy_id?: string | null
          policy_version?: number | null
          reason_codes?: string[]
          requested_amount_cents?: number
          requested_mode?: Database["public"]["Enums"]["yalla_payment_mode"]
        }
        Relationships: []
      }
      corporate_payment_policies: {
        Row: {
          approval_threshold_cents: number | null
          approved_at: string | null
          approved_by: string | null
          business_approval: string
          corporate_id: string
          created_at: string
          credit_rule: string
          daily_credit_exposure_cents: number | null
          id: string
          max_transaction_cents: number | null
          monthly_credit_exposure_cents: number | null
          proposed_by: string | null
          required_approval_role: Database["public"]["Enums"]["app_role"] | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          approval_threshold_cents?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_approval?: string
          corporate_id: string
          created_at?: string
          credit_rule?: string
          daily_credit_exposure_cents?: number | null
          id?: string
          max_transaction_cents?: number | null
          monthly_credit_exposure_cents?: number | null
          proposed_by?: string | null
          required_approval_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          approval_threshold_cents?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_approval?: string
          corporate_id?: string
          created_at?: string
          credit_rule?: string
          daily_credit_exposure_cents?: number | null
          id?: string
          max_transaction_cents?: number | null
          monthly_credit_exposure_cents?: number | null
          proposed_by?: string | null
          required_approval_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "corporate_payment_policies_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string
          corporate_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          owner_user_id: string | null
          parent_id: string | null
          status: Database["public"]["Enums"]["cost_center_status"]
          updated_at: string
        }
        Insert: {
          code: string
          corporate_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          owner_user_id?: string | null
          parent_id?: string | null
          status?: Database["public"]["Enums"]["cost_center_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          corporate_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          owner_user_id?: string | null
          parent_id?: string | null
          status?: Database["public"]["Enums"]["cost_center_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          active: boolean
          code: string
          created_at: string
          decimals: number
          is_base: boolean
          name: string
          symbol: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          decimals?: number
          is_base?: boolean
          name: string
          symbol?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          decimals?: number
          is_base?: boolean
          name?: string
          symbol?: string | null
        }
        Relationships: []
      }
      delivery_orders: {
        Row: {
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          metadata: Json
          module: string
          notes: string | null
          order_number: string
          payment_status: string
          pickup_address: string
          pickup_contact_name: string | null
          pickup_contact_phone: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_window_end: string | null
          pickup_window_start: string | null
          sla_deadline: string | null
          status: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          metadata?: Json
          module: string
          notes?: string | null
          order_number?: string
          payment_status?: string
          pickup_address: string
          pickup_contact_name?: string | null
          pickup_contact_phone?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          sla_deadline?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          metadata?: Json
          module?: string
          notes?: string | null
          order_number?: string
          payment_status?: string
          pickup_address?: string
          pickup_contact_name?: string | null
          pickup_contact_phone?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          sla_deadline?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      driver_applications: {
        Row: {
          applicant_user_id: string | null
          application_reference: string
          carrier_id: string | null
          claim_token: string
          contact_email: string
          contact_phone: string
          country: string
          county: string | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          driver_id: string | null
          driver_type: string
          first_name: string
          gender: string | null
          id: string
          kra_pin: string | null
          last_name: string
          licence_classes: string[]
          licence_expiry: string | null
          licence_number: string
          middle_name: string | null
          national_id: string
          notes: string | null
          preferred_city: string | null
          psv_badge_number: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          service_categories: string[]
          status: string
          town: string | null
          updated_at: string
          vehicle_make_model: string | null
          vehicle_ownership: string
          vehicle_registration: string | null
          years_experience: number | null
        }
        Insert: {
          applicant_user_id?: string | null
          application_reference: string
          carrier_id?: string | null
          claim_token: string
          contact_email: string
          contact_phone: string
          country?: string
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          decided_at?: string | null
          driver_id?: string | null
          driver_type?: string
          first_name: string
          gender?: string | null
          id?: string
          kra_pin?: string | null
          last_name: string
          licence_classes?: string[]
          licence_expiry?: string | null
          licence_number: string
          middle_name?: string | null
          national_id: string
          notes?: string | null
          preferred_city?: string | null
          psv_badge_number?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_categories?: string[]
          status?: string
          town?: string | null
          updated_at?: string
          vehicle_make_model?: string | null
          vehicle_ownership?: string
          vehicle_registration?: string | null
          years_experience?: number | null
        }
        Update: {
          applicant_user_id?: string | null
          application_reference?: string
          carrier_id?: string | null
          claim_token?: string
          contact_email?: string
          contact_phone?: string
          country?: string
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          decided_at?: string | null
          driver_id?: string | null
          driver_type?: string
          first_name?: string
          gender?: string | null
          id?: string
          kra_pin?: string | null
          last_name?: string
          licence_classes?: string[]
          licence_expiry?: string | null
          licence_number?: string
          middle_name?: string | null
          national_id?: string
          notes?: string | null
          preferred_city?: string | null
          psv_badge_number?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_categories?: string[]
          status?: string
          town?: string | null
          updated_at?: string
          vehicle_make_model?: string | null
          vehicle_ownership?: string
          vehicle_registration?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      driver_earnings: {
        Row: {
          amount: number
          created_at: string
          currency: string
          driver_id: string
          id: string
          trip_booking_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          driver_id: string
          id?: string
          trip_booking_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          driver_id?: string
          id?: string
          trip_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: true
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_etims_invoices: {
        Row: {
          attempt_count: number
          created_at: string
          currency: string
          driver_id: string
          gross_cents: number
          id: string
          invoice_number: string
          issued_at: string
          kra_invoice_no: string | null
          kra_qr_code: string | null
          last_error: string | null
          metadata: Json
          net_cents: number
          platform_invoice_id: string | null
          revenue_event_id: string | null
          status: Database["public"]["Enums"]["driver_etims_invoice_status"]
          tax_cents: number
          tax_rate_bps: number
          tax_scheme_code: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          currency?: string
          driver_id: string
          gross_cents: number
          id?: string
          invoice_number: string
          issued_at?: string
          kra_invoice_no?: string | null
          kra_qr_code?: string | null
          last_error?: string | null
          metadata?: Json
          net_cents: number
          platform_invoice_id?: string | null
          revenue_event_id?: string | null
          status?: Database["public"]["Enums"]["driver_etims_invoice_status"]
          tax_cents: number
          tax_rate_bps: number
          tax_scheme_code?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          currency?: string
          driver_id?: string
          gross_cents?: number
          id?: string
          invoice_number?: string
          issued_at?: string
          kra_invoice_no?: string | null
          kra_qr_code?: string | null
          last_error?: string | null
          metadata?: Json
          net_cents?: number
          platform_invoice_id?: string | null
          revenue_event_id?: string | null
          status?: Database["public"]["Enums"]["driver_etims_invoice_status"]
          tax_cents?: number
          tax_rate_bps?: number
          tax_scheme_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_etims_invoices_platform_invoice_id_fkey"
            columns: ["platform_invoice_id"]
            isOneToOne: false
            referencedRelation: "etims_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_etims_invoices_revenue_event_id_fkey"
            columns: ["revenue_event_id"]
            isOneToOne: false
            referencedRelation: "revenue_events"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_finance_clearance_events: {
        Row: {
          action: string
          actor_user_id: string | null
          clearance_id: string
          created_at: string
          id: string
          note: string | null
          state_from: string | null
          state_to: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          clearance_id: string
          created_at?: string
          id?: string
          note?: string | null
          state_from?: string | null
          state_to?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          clearance_id?: string
          created_at?: string
          id?: string
          note?: string | null
          state_from?: string | null
          state_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_finance_clearance_events_clearance_id_fkey"
            columns: ["clearance_id"]
            isOneToOne: false
            referencedRelation: "driver_finance_clearances"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_finance_clearances: {
        Row: {
          application_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          driver_id: string | null
          driver_user_id: string
          id: string
          note: string | null
          state: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          driver_id?: string | null
          driver_user_id: string
          id?: string
          note?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          driver_id?: string | null
          driver_user_id?: string
          id?: string
          note?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_finance_clearances_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "driver_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_finance_clearances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payout_batches: {
        Row: {
          batch_number: string
          created_at: string
          currency: string
          id: string
          metadata: Json
          provider: string
          provider_batch_ref: string | null
          scheduled_for: string
          settled_at: string | null
          status: Database["public"]["Enums"]["driver_payout_batch_status"]
          submitted_at: string | null
          total_amount_cents: number
          total_count: number
          updated_at: string
        }
        Insert: {
          batch_number: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider: string
          provider_batch_ref?: string | null
          scheduled_for?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["driver_payout_batch_status"]
          submitted_at?: string | null
          total_amount_cents?: number
          total_count?: number
          updated_at?: string
        }
        Update: {
          batch_number?: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_batch_ref?: string | null
          scheduled_for?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["driver_payout_batch_status"]
          submitted_at?: string | null
          total_amount_cents?: number
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      driver_payout_failures: {
        Row: {
          error_code: string | null
          error_message: string
          id: string
          occurred_at: string
          payload: Json | null
          payout_id: string
          retry_count: number
        }
        Insert: {
          error_code?: string | null
          error_message: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          payout_id: string
          retry_count?: number
        }
        Update: {
          error_code?: string | null
          error_message?: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          payout_id?: string
          retry_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_payout_failures_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payout_methods: {
        Row: {
          account_name: string | null
          bank_account: string | null
          bank_code: string | null
          created_at: string
          driver_id: string
          id: string
          is_default: boolean
          metadata: Json
          method_type: Database["public"]["Enums"]["driver_payout_method_type"]
          msisdn: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          account_name?: string | null
          bank_account?: string | null
          bank_code?: string | null
          created_at?: string
          driver_id: string
          id?: string
          is_default?: boolean
          metadata?: Json
          method_type: Database["public"]["Enums"]["driver_payout_method_type"]
          msisdn?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          account_name?: string | null
          bank_account?: string | null
          bank_code?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          is_default?: boolean
          metadata?: Json
          method_type?: Database["public"]["Enums"]["driver_payout_method_type"]
          msisdn?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      driver_payout_reconciliation: {
        Row: {
          actual_amount_cents: number
          actual_count: number
          batch_id: string
          created_at: string
          expected_amount_cents: number
          expected_count: number
          id: string
          notes: string | null
          status: string
          variance_cents: number | null
        }
        Insert: {
          actual_amount_cents: number
          actual_count: number
          batch_id: string
          created_at?: string
          expected_amount_cents: number
          expected_count: number
          id?: string
          notes?: string | null
          status: string
          variance_cents?: number | null
        }
        Update: {
          actual_amount_cents?: number
          actual_count?: number
          batch_id?: string
          created_at?: string
          expected_amount_cents?: number
          expected_count?: number
          id?: string
          notes?: string | null
          status?: string
          variance_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_payout_reconciliation_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "driver_payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payout_reversals: {
        Row: {
          created_at: string
          id: string
          initiated_by: string | null
          payout_id: string
          reason: string
          reversal_journal_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          initiated_by?: string | null
          payout_id: string
          reason: string
          reversal_journal_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          initiated_by?: string | null
          payout_id?: string
          reason?: string
          reversal_journal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_payout_reversals_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payout_reversals_reversal_journal_id_fkey"
            columns: ["reversal_journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payouts: {
        Row: {
          amount_cents: number
          approved_at: string | null
          approved_by: string | null
          batch_id: string | null
          created_at: string
          currency: string
          driver_id: string
          id: string
          journal_id: string | null
          metadata: Json
          method_id: string
          net_payout_cents: number | null
          paid_at: string | null
          provider_txn_id: string | null
          reference: string | null
          requested_by: string | null
          reversal_of: string | null
          status: Database["public"]["Enums"]["driver_payout_status"]
          tax_withheld_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          created_at?: string
          currency?: string
          driver_id: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          method_id: string
          net_payout_cents?: number | null
          paid_at?: string | null
          provider_txn_id?: string | null
          reference?: string | null
          requested_by?: string | null
          reversal_of?: string | null
          status?: Database["public"]["Enums"]["driver_payout_status"]
          tax_withheld_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          method_id?: string
          net_payout_cents?: number | null
          paid_at?: string | null
          provider_txn_id?: string | null
          reference?: string | null
          requested_by?: string | null
          reversal_of?: string | null
          status?: Database["public"]["Enums"]["driver_payout_status"]
          tax_withheld_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_payouts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "driver_payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payouts_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payouts_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "driver_payout_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payouts_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_tax_elections: {
        Row: {
          created_at: string
          document_ref: string | null
          driver_id: string
          effective_from: string
          effective_to: string | null
          elected_at: string
          elected_by: string | null
          id: string
          notes: string | null
          regime: Database["public"]["Enums"]["driver_tax_regime"]
        }
        Insert: {
          created_at?: string
          document_ref?: string | null
          driver_id: string
          effective_from: string
          effective_to?: string | null
          elected_at?: string
          elected_by?: string | null
          id?: string
          notes?: string | null
          regime: Database["public"]["Enums"]["driver_tax_regime"]
        }
        Update: {
          created_at?: string
          document_ref?: string | null
          driver_id?: string
          effective_from?: string
          effective_to?: string | null
          elected_at?: string
          elected_by?: string | null
          id?: string
          notes?: string | null
          regime?: Database["public"]["Enums"]["driver_tax_regime"]
        }
        Relationships: []
      }
      driver_tax_liabilities: {
        Row: {
          amount_cents: number
          created_at: string
          driver_id: string
          due_date: string
          id: string
          journal_id: string | null
          metadata: Json
          paid_cents: number
          period_end: string
          period_start: string
          rate_bps: number
          scheme_code: string
          status: Database["public"]["Enums"]["driver_tax_liability_status"]
          taxable_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          driver_id: string
          due_date: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          paid_cents?: number
          period_end: string
          period_start: string
          rate_bps: number
          scheme_code: string
          status?: Database["public"]["Enums"]["driver_tax_liability_status"]
          taxable_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          driver_id?: string
          due_date?: string
          id?: string
          journal_id?: string | null
          metadata?: Json
          paid_cents?: number
          period_end?: string
          period_start?: string
          rate_bps?: number
          scheme_code?: string
          status?: Database["public"]["Enums"]["driver_tax_liability_status"]
          taxable_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_tax_liabilities_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_tax_payments: {
        Row: {
          amount_cents: number
          created_at: string
          driver_id: string
          id: string
          journal_id: string | null
          liability_id: string
          metadata: Json
          paid_at: string
          reference: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          driver_id: string
          id?: string
          journal_id?: string | null
          liability_id: string
          metadata?: Json
          paid_at?: string
          reference?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          driver_id?: string
          id?: string
          journal_id?: string | null
          liability_id?: string
          metadata?: Json
          paid_at?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_tax_payments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_tax_payments_liability_id_fkey"
            columns: ["liability_id"]
            isOneToOne: false
            referencedRelation: "driver_tax_liabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_tax_profiles: {
        Row: {
          annual_turnover_cents: number
          created_at: string
          current_regime: Database["public"]["Enums"]["driver_tax_regime"]
          driver_id: string
          id: string
          kra_pin: string
          metadata: Json
          registered_at: string | null
          status: Database["public"]["Enums"]["driver_tax_profile_status"]
          updated_at: string
          vat_number: string | null
          vat_registered: boolean
        }
        Insert: {
          annual_turnover_cents?: number
          created_at?: string
          current_regime?: Database["public"]["Enums"]["driver_tax_regime"]
          driver_id: string
          id?: string
          kra_pin: string
          metadata?: Json
          registered_at?: string | null
          status?: Database["public"]["Enums"]["driver_tax_profile_status"]
          updated_at?: string
          vat_number?: string | null
          vat_registered?: boolean
        }
        Update: {
          annual_turnover_cents?: number
          created_at?: string
          current_regime?: Database["public"]["Enums"]["driver_tax_regime"]
          driver_id?: string
          id?: string
          kra_pin?: string
          metadata?: Json
          registered_at?: string | null
          status?: Database["public"]["Enums"]["driver_tax_profile_status"]
          updated_at?: string
          vat_number?: string | null
          vat_registered?: boolean
        }
        Relationships: []
      }
      driver_tax_reports: {
        Row: {
          created_at: string
          currency: string
          driver_id: string
          gross_cents: number
          id: string
          metadata: Json | null
          period_end: string
          period_start: string
          status: string
          tax_cents: number
          taxable_cents: number
        }
        Insert: {
          created_at?: string
          currency?: string
          driver_id: string
          gross_cents?: number
          id?: string
          metadata?: Json | null
          period_end: string
          period_start: string
          status?: string
          tax_cents?: number
          taxable_cents?: number
        }
        Update: {
          created_at?: string
          currency?: string
          driver_id?: string
          gross_cents?: number
          id?: string
          metadata?: Json | null
          period_end?: string
          period_start?: string
          status?: string
          tax_cents?: number
          taxable_cents?: number
        }
        Relationships: []
      }
      driver_tax_returns: {
        Row: {
          acknowledgement_ref: string | null
          created_at: string
          driver_id: string
          filed_at: string | null
          gross_cents: number
          id: string
          payload: Json
          period_end: string
          period_start: string
          regime: Database["public"]["Enums"]["driver_tax_regime"]
          scheme_code: string
          status: Database["public"]["Enums"]["driver_tax_return_status"]
          tax_due_cents: number
          taxable_cents: number
          updated_at: string
        }
        Insert: {
          acknowledgement_ref?: string | null
          created_at?: string
          driver_id: string
          filed_at?: string | null
          gross_cents?: number
          id?: string
          payload?: Json
          period_end: string
          period_start: string
          regime: Database["public"]["Enums"]["driver_tax_regime"]
          scheme_code: string
          status?: Database["public"]["Enums"]["driver_tax_return_status"]
          tax_due_cents?: number
          taxable_cents?: number
          updated_at?: string
        }
        Update: {
          acknowledgement_ref?: string | null
          created_at?: string
          driver_id?: string
          filed_at?: string | null
          gross_cents?: number
          id?: string
          payload?: Json
          period_end?: string
          period_start?: string
          regime?: Database["public"]["Enums"]["driver_tax_regime"]
          scheme_code?: string
          status?: Database["public"]["Enums"]["driver_tax_return_status"]
          tax_due_cents?: number
          taxable_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          created_at: string
          driver_code: string
          driver_rating: number | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          risk_score: number | null
          status: string
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          driver_code?: string
          driver_rating?: number | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          risk_score?: number | null
          status?: string
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          driver_code?: string
          driver_rating?: number | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          risk_score?: number | null
          status?: string
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: []
      }
      emergency_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean | null
          name: string
          phone_number: string
          relationship: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name: string
          phone_number: string
          relationship?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name?: string
          phone_number?: string
          relationship?: string | null
          user_id?: string
        }
        Relationships: []
      }
      etims_invoice_items: {
        Row: {
          created_at: string
          description: string
          discount_cents: number
          hs_code: string | null
          id: string
          invoice_id: string
          item_code: string | null
          line_number: number
          metadata: Json
          quantity: number
          tax_cents: number
          tax_rate_bps: number
          tax_scheme_code: string
          taxable_cents: number
          total_cents: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          discount_cents?: number
          hs_code?: string | null
          id?: string
          invoice_id: string
          item_code?: string | null
          line_number: number
          metadata?: Json
          quantity?: number
          tax_cents?: number
          tax_rate_bps?: number
          tax_scheme_code: string
          taxable_cents: number
          total_cents: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          description?: string
          discount_cents?: number
          hs_code?: string | null
          id?: string
          invoice_id?: string
          item_code?: string | null
          line_number?: number
          metadata?: Json
          quantity?: number
          tax_cents?: number
          tax_rate_bps?: number
          tax_scheme_code?: string
          taxable_cents?: number
          total_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "etims_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "etims_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etims_invoice_items_tax_scheme_code_fkey"
            columns: ["tax_scheme_code"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["code"]
          },
        ]
      }
      etims_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          customer_email: string | null
          customer_kra_pin: string | null
          customer_name: string
          customer_phone: string | null
          customer_user_id: string | null
          id: string
          invoice_number: string
          invoice_type: Database["public"]["Enums"]["etims_invoice_type"]
          issued_at: string
          journal_id: string | null
          kra_control_unit_id: string | null
          kra_invoice_number: string | null
          kra_signature: string | null
          last_error: string | null
          metadata: Json
          qr_code_payload: string | null
          references_invoice_id: string | null
          retry_count: number
          revenue_event_id: string | null
          status: Database["public"]["Enums"]["etims_invoice_status"]
          subtotal_cents: number
          synced_at: string | null
          tax_total_cents: number
          total_cents: number
          transaction_id: string | null
          updated_at: string
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_kra_pin?: string | null
          customer_name: string
          customer_phone?: string | null
          customer_user_id?: string | null
          id?: string
          invoice_number: string
          invoice_type?: Database["public"]["Enums"]["etims_invoice_type"]
          issued_at?: string
          journal_id?: string | null
          kra_control_unit_id?: string | null
          kra_invoice_number?: string | null
          kra_signature?: string | null
          last_error?: string | null
          metadata?: Json
          qr_code_payload?: string | null
          references_invoice_id?: string | null
          retry_count?: number
          revenue_event_id?: string | null
          status?: Database["public"]["Enums"]["etims_invoice_status"]
          subtotal_cents: number
          synced_at?: string | null
          tax_total_cents?: number
          total_cents: number
          transaction_id?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_kra_pin?: string | null
          customer_name?: string
          customer_phone?: string | null
          customer_user_id?: string | null
          id?: string
          invoice_number?: string
          invoice_type?: Database["public"]["Enums"]["etims_invoice_type"]
          issued_at?: string
          journal_id?: string | null
          kra_control_unit_id?: string | null
          kra_invoice_number?: string | null
          kra_signature?: string | null
          last_error?: string | null
          metadata?: Json
          qr_code_payload?: string | null
          references_invoice_id?: string | null
          retry_count?: number
          revenue_event_id?: string | null
          status?: Database["public"]["Enums"]["etims_invoice_status"]
          subtotal_cents?: number
          synced_at?: string | null
          tax_total_cents?: number
          total_cents?: number
          transaction_id?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etims_invoices_references_invoice_id_fkey"
            columns: ["references_invoice_id"]
            isOneToOne: false
            referencedRelation: "etims_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          base_currency: string
          created_at: string
          created_by: string | null
          id: string
          provider: string
          quote_currency: string
          rate: number
          rate_date: string
          rate_type: Database["public"]["Enums"]["fx_rate_type"]
        }
        Insert: {
          base_currency: string
          created_at?: string
          created_by?: string | null
          id?: string
          provider?: string
          quote_currency: string
          rate: number
          rate_date: string
          rate_type?: Database["public"]["Enums"]["fx_rate_type"]
        }
        Update: {
          base_currency?: string
          created_at?: string
          created_by?: string | null
          id?: string
          provider?: string
          quote_currency?: string
          rate?: number
          rate_date?: string
          rate_type?: Database["public"]["Enums"]["fx_rate_type"]
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_quote_currency_fkey"
            columns: ["quote_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      fact_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          driver_id: string | null
          id: string
          paid_at: string | null
          payment_id: string
          payment_method: string | null
          rider_id: string | null
          status: string | null
          trip_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          id?: string
          paid_at?: string | null
          payment_id: string
          payment_method?: string | null
          rider_id?: string | null
          status?: string | null
          trip_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          id?: string
          paid_at?: string | null
          payment_id?: string
          payment_method?: string | null
          rider_id?: string | null
          status?: string | null
          trip_id?: string | null
        }
        Relationships: []
      }
      family_accounts: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          shared_wallet_balance: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          shared_wallet_balance?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          shared_wallet_balance?: number
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          display_name: string
          family_account_id: string
          id: string
          is_minor: boolean | null
          member_user_id: string | null
          per_trip_limit: number | null
          relationship: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          family_account_id: string
          id?: string
          is_minor?: boolean | null
          member_user_id?: string | null
          per_trip_limit?: number | null
          relationship?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          family_account_id?: string
          id?: string
          is_minor?: boolean | null
          member_user_id?: string | null
          per_trip_limit?: number | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_account_id_fkey"
            columns: ["family_account_id"]
            isOneToOne: false
            referencedRelation: "family_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_locations: {
        Row: {
          address: string
          created_at: string
          icon: string | null
          id: string
          label: string
          lat: number
          lng: number
          place_id: string | null
          sort_order: number | null
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          lat: number
          lng: number
          place_id?: string | null
          sort_order?: number | null
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          lat?: number
          lng?: number
          place_id?: string | null
          sort_order?: number | null
          user_id?: string
        }
        Relationships: []
      }
      fin_ledger_entries: {
        Row: {
          account_code: string
          account_name: string
          corporate_id: string | null
          correlation_id: string | null
          created_at: string
          created_by: string | null
          credit_cents: number
          currency: string
          debit_cents: number
          entry_group: string
          id: string
          intent_id: string | null
          kind: Database["public"]["Enums"]["fin_ledger_entry_kind"]
          memo: string | null
          reference: string | null
        }
        Insert: {
          account_code: string
          account_name: string
          corporate_id?: string | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_cents?: number
          currency?: string
          debit_cents?: number
          entry_group: string
          id?: string
          intent_id?: string | null
          kind: Database["public"]["Enums"]["fin_ledger_entry_kind"]
          memo?: string | null
          reference?: string | null
        }
        Update: {
          account_code?: string
          account_name?: string
          corporate_id?: string | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_cents?: number
          currency?: string
          debit_cents?: number
          entry_group?: string
          id?: string
          intent_id?: string | null
          kind?: Database["public"]["Enums"]["fin_ledger_entry_kind"]
          memo?: string | null
          reference?: string | null
        }
        Relationships: []
      }
      fin_payment_reports: {
        Row: {
          amount: number
          booking_ref: string
          charter_booking_id: string | null
          created_at: string
          currency: string
          decision_note: string | null
          id: string
          method: string
          note: string | null
          paid_on: string
          payment_reference: string | null
          reported_by: string | null
          source: string
          source_message_id: string | null
          status: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          booking_ref: string
          charter_booking_id?: string | null
          created_at?: string
          currency?: string
          decision_note?: string | null
          id?: string
          method?: string
          note?: string | null
          paid_on: string
          payment_reference?: string | null
          reported_by?: string | null
          source: string
          source_message_id?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          booking_ref?: string
          charter_booking_id?: string | null
          created_at?: string
          currency?: string
          decision_note?: string | null
          id?: string
          method?: string
          note?: string | null
          paid_on?: string
          payment_reference?: string | null
          reported_by?: string | null
          source?: string
          source_message_id?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fin_payment_reports_charter_booking_id_fkey"
            columns: ["charter_booking_id"]
            isOneToOne: false
            referencedRelation: "charter_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_change_audit: {
        Row: {
          change_source: string
          changed_by: string | null
          changed_by_email: string | null
          created_at: string
          entity_id: string | null
          entity_key: string
          entity_kind: string
          field: string
          field_class: string
          id: string
          operation: string
          reason: string | null
          snapshot_after: Json | null
          snapshot_before: Json | null
          value_after: string | null
          value_before: string | null
        }
        Insert: {
          change_source?: string
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          entity_id?: string | null
          entity_key: string
          entity_kind: string
          field: string
          field_class: string
          id?: string
          operation: string
          reason?: string | null
          snapshot_after?: Json | null
          snapshot_before?: Json | null
          value_after?: string | null
          value_before?: string | null
        }
        Update: {
          change_source?: string
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          entity_id?: string | null
          entity_key?: string
          entity_kind?: string
          field?: string
          field_class?: string
          id?: string
          operation?: string
          reason?: string | null
          snapshot_after?: Json | null
          snapshot_before?: Json | null
          value_after?: string | null
          value_before?: string | null
        }
        Relationships: []
      }
      finance_distribution_lists: {
        Row: {
          active: boolean
          created_at: string
          department: string
          email: string
          id: string
          role: string | null
          severity_threshold: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department: string
          email: string
          id?: string
          role?: string | null
          severity_threshold?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string
          email?: string
          id?: string
          role?: string | null
          severity_threshold?: string
          updated_at?: string
        }
        Relationships: []
      }
      freight_awards: {
        Row: {
          award_justification: string
          award_number: string
          awarded_at: string
          awarded_by: string
          awarded_total: number
          bypass_reason: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          carrier_id: string
          countersigned_at: string | null
          countersigned_by: string | null
          created_at: string
          currency: string
          evaluation_snapshot: Json
          id: string
          idempotency_key: string | null
          lowest_price_bypassed: boolean
          quotation_id: string
          requirement_id: string
          reservation_id: string | null
          rfq_id: string
          status: string
        }
        Insert: {
          award_justification: string
          award_number: string
          awarded_at?: string
          awarded_by: string
          awarded_total: number
          bypass_reason?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_id: string
          countersigned_at?: string | null
          countersigned_by?: string | null
          created_at?: string
          currency?: string
          evaluation_snapshot?: Json
          id?: string
          idempotency_key?: string | null
          lowest_price_bypassed?: boolean
          quotation_id: string
          requirement_id: string
          reservation_id?: string | null
          rfq_id: string
          status?: string
        }
        Update: {
          award_justification?: string
          award_number?: string
          awarded_at?: string
          awarded_by?: string
          awarded_total?: number
          bypass_reason?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_id?: string
          countersigned_at?: string | null
          countersigned_by?: string | null
          created_at?: string
          currency?: string
          evaluation_snapshot?: Json
          id?: string
          idempotency_key?: string | null
          lowest_price_bypassed?: boolean
          quotation_id?: string
          requirement_id?: string
          reservation_id?: string | null
          rfq_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_awards_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_awards_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "carrier_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_awards_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "freight_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_awards_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "capacity_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_awards_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "freight_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_bookings: {
        Row: {
          agreed_total: number
          award_id: string
          booking_number: string
          cancel_reason: string | null
          cancelled_at: string | null
          carrier_accepted_at: string | null
          carrier_decline_reason: string | null
          carrier_declined_at: string | null
          carrier_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          dispatch_job_id: string | null
          dispatched_at: string | null
          driver_user_id: string | null
          id: string
          idempotency_key: string | null
          manifest_id: string | null
          order_id: string | null
          planned_delivery: string | null
          planned_pickup: string | null
          requirement_id: string
          reservation_id: string | null
          route_id: string | null
          route_version_id: string | null
          state: Database["public"]["Enums"]["freight_booking_state"]
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          agreed_total: number
          award_id: string
          booking_number: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_accepted_at?: string | null
          carrier_decline_reason?: string | null
          carrier_declined_at?: string | null
          carrier_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dispatch_job_id?: string | null
          dispatched_at?: string | null
          driver_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          manifest_id?: string | null
          order_id?: string | null
          planned_delivery?: string | null
          planned_pickup?: string | null
          requirement_id: string
          reservation_id?: string | null
          route_id?: string | null
          route_version_id?: string | null
          state?: Database["public"]["Enums"]["freight_booking_state"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          agreed_total?: number
          award_id?: string
          booking_number?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_accepted_at?: string | null
          carrier_decline_reason?: string | null
          carrier_declined_at?: string | null
          carrier_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dispatch_job_id?: string | null
          dispatched_at?: string | null
          driver_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          manifest_id?: string | null
          order_id?: string | null
          planned_delivery?: string | null
          planned_pickup?: string | null
          requirement_id?: string
          reservation_id?: string | null
          route_id?: string | null
          route_version_id?: string | null
          state?: Database["public"]["Enums"]["freight_booking_state"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_bookings_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: true
            referencedRelation: "freight_awards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "logistics_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "freight_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "capacity_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_route_version_id_fkey"
            columns: ["route_version_id"]
            isOneToOne: false
            referencedRelation: "logistics_route_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_bookings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_carrier_settlements: {
        Row: {
          adjustments_amount: number
          approved_at: string | null
          approved_by: string | null
          carrier_claimed_amount: number | null
          carrier_id: string
          contract_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          currency: string
          gross_amount: number
          id: string
          idempotency_key: string | null
          net_payable: number
          paid_at: string | null
          payout_reference: string | null
          period_end: string
          period_start: string
          reversal_reason: string | null
          reversed_at: string | null
          settlement_number: string
          status: Database["public"]["Enums"]["freight_settlement_status"]
          tax_amount: number
          updated_at: string
          variance_amount: number
        }
        Insert: {
          adjustments_amount?: number
          approved_at?: string | null
          approved_by?: string | null
          carrier_claimed_amount?: number | null
          carrier_id: string
          contract_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_amount?: number
          id?: string
          idempotency_key?: string | null
          net_payable?: number
          paid_at?: string | null
          payout_reference?: string | null
          period_end: string
          period_start: string
          reversal_reason?: string | null
          reversed_at?: string | null
          settlement_number: string
          status?: Database["public"]["Enums"]["freight_settlement_status"]
          tax_amount?: number
          updated_at?: string
          variance_amount?: number
        }
        Update: {
          adjustments_amount?: number
          approved_at?: string | null
          approved_by?: string | null
          carrier_claimed_amount?: number | null
          carrier_id?: string
          contract_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_amount?: number
          id?: string
          idempotency_key?: string | null
          net_payable?: number
          paid_at?: string | null
          payout_reference?: string | null
          period_end?: string
          period_start?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          settlement_number?: string
          status?: Database["public"]["Enums"]["freight_settlement_status"]
          tax_amount?: number
          updated_at?: string
          variance_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "freight_carrier_settlements_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_carrier_settlements_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "carrier_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_charge_adjustments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          charge_id: string
          correlation_id: string | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string | null
          kind: string
          reason_code: string
          reason_note: string | null
          requested_by: string
          status: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          charge_id: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          kind: string
          reason_code: string
          reason_note?: string | null
          requested_by: string
          status?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          charge_id?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          reason_code?: string
          reason_note?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_charge_adjustments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "freight_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_charge_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          charge_id: string
          correlation_id: string | null
          created_at: string
          detail: Json
          from_status:
            | Database["public"]["Enums"]["freight_charge_status"]
            | null
          id: string
          note: string | null
          reason_code: string | null
          to_status: Database["public"]["Enums"]["freight_charge_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          charge_id: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          from_status?:
            | Database["public"]["Enums"]["freight_charge_status"]
            | null
          id?: string
          note?: string | null
          reason_code?: string | null
          to_status: Database["public"]["Enums"]["freight_charge_status"]
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          charge_id?: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          from_status?:
            | Database["public"]["Enums"]["freight_charge_status"]
            | null
          id?: string
          note?: string | null
          reason_code?: string | null
          to_status?: Database["public"]["Enums"]["freight_charge_status"]
        }
        Relationships: [
          {
            foreignKeyName: "freight_charge_events_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "freight_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_charges: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          award_id: string | null
          basis: Database["public"]["Enums"]["freight_pricing_basis"]
          booking_id: string | null
          carrier_id: string | null
          charge_code: string
          charge_number: string
          commercial_snapshot: Json
          corporate_account_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          currency: string
          customer_user_id: string | null
          id: string
          idempotency_key: string
          invoice_id: string | null
          manifest_id: string | null
          operational_evidence: Json
          order_id: string | null
          package_id: string | null
          party: Database["public"]["Enums"]["freight_charge_party"]
          quantity: number
          quote_id: string | null
          rate_card_id: string | null
          rate_line_id: string | null
          reason_code: string | null
          request_id: string | null
          route_id: string | null
          settlement_id: string | null
          status: Database["public"]["Enums"]["freight_charge_status"]
          stop_id: string | null
          tax_amount: number
          unit_rate: number
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          award_id?: string | null
          basis: Database["public"]["Enums"]["freight_pricing_basis"]
          booking_id?: string | null
          carrier_id?: string | null
          charge_code: string
          charge_number: string
          commercial_snapshot?: Json
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_user_id?: string | null
          id?: string
          idempotency_key: string
          invoice_id?: string | null
          manifest_id?: string | null
          operational_evidence?: Json
          order_id?: string | null
          package_id?: string | null
          party: Database["public"]["Enums"]["freight_charge_party"]
          quantity?: number
          quote_id?: string | null
          rate_card_id?: string | null
          rate_line_id?: string | null
          reason_code?: string | null
          request_id?: string | null
          route_id?: string | null
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["freight_charge_status"]
          stop_id?: string | null
          tax_amount?: number
          unit_rate?: number
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          award_id?: string | null
          basis?: Database["public"]["Enums"]["freight_pricing_basis"]
          booking_id?: string | null
          carrier_id?: string | null
          charge_code?: string
          charge_number?: string
          commercial_snapshot?: Json
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_user_id?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string | null
          manifest_id?: string | null
          operational_evidence?: Json
          order_id?: string | null
          package_id?: string | null
          party?: Database["public"]["Enums"]["freight_charge_party"]
          quantity?: number
          quote_id?: string | null
          rate_card_id?: string | null
          rate_line_id?: string | null
          reason_code?: string | null
          request_id?: string | null
          route_id?: string | null
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["freight_charge_status"]
          stop_id?: string | null
          tax_amount?: number
          unit_rate?: number
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_charges_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: false
            referencedRelation: "freight_awards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "freight_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "logistics_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "freight_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "carrier_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_charges_rate_line_id_fkey"
            columns: ["rate_line_id"]
            isOneToOne: false
            referencedRelation: "carrier_rate_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_consignments: {
        Row: {
          cargo_type: string
          chargeable_weight_kg: number | null
          commodity: string | null
          consignee_name: string | null
          consignee_phone: string | null
          consignment_number: string
          created_at: string
          created_by: string | null
          currency: string
          declared_value: number | null
          delivery_address: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination_hub_id: string | null
          fragile: boolean
          gross_weight_kg: number
          hazard_class: string | null
          hazardous: boolean
          id: string
          loading_requirements: string[]
          notes: string | null
          order_id: string
          origin_hub_id: string | null
          package_type: string | null
          pieces: number
          service_level: string
          shipper_name: string | null
          shipper_phone: string | null
          special_handling: string[]
          temp_max_c: number | null
          temp_min_c: number | null
          updated_at: string
          volume_cbm: number | null
        }
        Insert: {
          cargo_type: string
          chargeable_weight_kg?: number | null
          commodity?: string | null
          consignee_name?: string | null
          consignee_phone?: string | null
          consignment_number: string
          created_at?: string
          created_by?: string | null
          currency?: string
          declared_value?: number | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_hub_id?: string | null
          fragile?: boolean
          gross_weight_kg: number
          hazard_class?: string | null
          hazardous?: boolean
          id?: string
          loading_requirements?: string[]
          notes?: string | null
          order_id: string
          origin_hub_id?: string | null
          package_type?: string | null
          pieces?: number
          service_level?: string
          shipper_name?: string | null
          shipper_phone?: string | null
          special_handling?: string[]
          temp_max_c?: number | null
          temp_min_c?: number | null
          updated_at?: string
          volume_cbm?: number | null
        }
        Update: {
          cargo_type?: string
          chargeable_weight_kg?: number | null
          commodity?: string | null
          consignee_name?: string | null
          consignee_phone?: string | null
          consignment_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          declared_value?: number | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_hub_id?: string | null
          fragile?: boolean
          gross_weight_kg?: number
          hazard_class?: string | null
          hazardous?: boolean
          id?: string
          loading_requirements?: string[]
          notes?: string | null
          order_id?: string
          origin_hub_id?: string | null
          package_type?: string | null
          pieces?: number
          service_level?: string
          shipper_name?: string | null
          shipper_phone?: string | null
          special_handling?: string[]
          temp_max_c?: number | null
          temp_min_c?: number | null
          updated_at?: string
          volume_cbm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_consignments_destination_hub_id_fkey"
            columns: ["destination_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_consignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_consignments_origin_hub_id_fkey"
            columns: ["origin_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_invoice_lines: {
        Row: {
          amount: number
          charge_id: string
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_no: number
          lineage: Json
          quantity: number
          tax_amount: number
          unit_rate: number
        }
        Insert: {
          amount?: number
          charge_id: string
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_no: number
          lineage?: Json
          quantity?: number
          tax_amount?: number
          unit_rate?: number
        }
        Update: {
          amount?: number
          charge_id?: string
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_no?: number
          lineage?: Json
          quantity?: number
          tax_amount?: number
          unit_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "freight_invoice_lines_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "freight_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "freight_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_invoices: {
        Row: {
          carrier_id: string | null
          corporate_account_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          currency: string
          customer_user_id: string | null
          due_at: string | null
          id: string
          idempotency_key: string | null
          invoice_number: string
          issued_at: string | null
          paid_total: number
          party: Database["public"]["Enums"]["freight_charge_party"]
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["freight_invoice_status"]
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          carrier_id?: string | null
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_user_id?: string | null
          due_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_number: string
          issued_at?: string | null
          paid_total?: number
          party?: Database["public"]["Enums"]["freight_charge_party"]
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["freight_invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          carrier_id?: string | null
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_user_id?: string | null
          due_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_number?: string
          issued_at?: string | null
          paid_total?: number
          party?: Database["public"]["Enums"]["freight_charge_party"]
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["freight_invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_invoices_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_payment_allocations: {
        Row: {
          allocated_by: string | null
          amount: number
          correlation_id: string | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string | null
          invoice_line_id: string | null
          mpesa_transaction_id: string | null
          payment_attempt_id: string | null
          provider: string
          provider_reference: string | null
          provider_status: string | null
          request_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          state: Database["public"]["Enums"]["freight_alloc_state"]
          unmatched_reason: string | null
          updated_at: string
        }
        Insert: {
          allocated_by?: string | null
          amount: number
          correlation_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key: string
          invoice_id?: string | null
          invoice_line_id?: string | null
          mpesa_transaction_id?: string | null
          payment_attempt_id?: string | null
          provider?: string
          provider_reference?: string | null
          provider_status?: string | null
          request_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          state: Database["public"]["Enums"]["freight_alloc_state"]
          unmatched_reason?: string | null
          updated_at?: string
        }
        Update: {
          allocated_by?: string | null
          amount?: number
          correlation_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string | null
          invoice_line_id?: string | null
          mpesa_transaction_id?: string | null
          payment_attempt_id?: string | null
          provider?: string
          provider_reference?: string | null
          provider_status?: string | null
          request_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          state?: Database["public"]["Enums"]["freight_alloc_state"]
          unmatched_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "freight_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_payment_allocations_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "freight_invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_payment_allocations_mpesa_transaction_id_fkey"
            columns: ["mpesa_transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_payment_allocations_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_quotations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          base_amount: number
          cargo: Json
          correlation_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          destination_label: string
          distance_basis: string | null
          distance_km: number | null
          hub_transfers: number
          id: string
          inputs: Json
          issued_at: string
          items: Json
          lines: Json
          offering_code: string
          order_id: string | null
          origin_label: string
          planned_legs: Json
          pricing_version: string
          quote_number: string
          rate_plan_id: string
          rate_plan_version: number
          rate_source: string
          rejected_at: string | null
          rejection_reason: string | null
          snapshot_hash: string
          status: string
          surcharges_amount: number
          tax_amount: number
          total_amount: number
          updated_at: string
          valid_until: string
          vehicle_class: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          base_amount: number
          cargo?: Json
          correlation_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          destination_label: string
          distance_basis?: string | null
          distance_km?: number | null
          hub_transfers?: number
          id?: string
          inputs: Json
          issued_at?: string
          items?: Json
          lines: Json
          offering_code?: string
          order_id?: string | null
          origin_label: string
          planned_legs?: Json
          pricing_version: string
          quote_number: string
          rate_plan_id: string
          rate_plan_version: number
          rate_source?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          snapshot_hash: string
          status?: string
          surcharges_amount?: number
          tax_amount?: number
          total_amount: number
          updated_at?: string
          valid_until: string
          vehicle_class?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          base_amount?: number
          cargo?: Json
          correlation_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          destination_label?: string
          distance_basis?: string | null
          distance_km?: number | null
          hub_transfers?: number
          id?: string
          inputs?: Json
          issued_at?: string
          items?: Json
          lines?: Json
          offering_code?: string
          order_id?: string | null
          origin_label?: string
          planned_legs?: Json
          pricing_version?: string
          quote_number?: string
          rate_plan_id?: string
          rate_plan_version?: number
          rate_source?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          snapshot_hash?: string
          status?: string
          surcharges_amount?: number
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          valid_until?: string
          vehicle_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_quotations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          corporate_account_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          currency: string
          expires_at: string
          id: string
          idempotency_key: string | null
          offering_code: string
          order_id: string | null
          owner_user_id: string | null
          quote_reference: string
          quoted_amount: number
          rate_card_id: string | null
          rate_plan_version: number | null
          requirement_id: string | null
          snapshot: Json
          status: Database["public"]["Enums"]["freight_quote_status"]
          superseded_by_quote_id: string | null
          tax_amount: number
          updated_at: string
          valid_from: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          offering_code: string
          order_id?: string | null
          owner_user_id?: string | null
          quote_reference: string
          quoted_amount?: number
          rate_card_id?: string | null
          rate_plan_version?: number | null
          requirement_id?: string | null
          snapshot?: Json
          status?: Database["public"]["Enums"]["freight_quote_status"]
          superseded_by_quote_id?: string | null
          tax_amount?: number
          updated_at?: string
          valid_from?: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          corporate_account_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          offering_code?: string
          order_id?: string | null
          owner_user_id?: string | null
          quote_reference?: string
          quoted_amount?: number
          rate_card_id?: string | null
          rate_plan_version?: number | null
          requirement_id?: string | null
          snapshot?: Json
          status?: Database["public"]["Enums"]["freight_quote_status"]
          superseded_by_quote_id?: string | null
          tax_amount?: number
          updated_at?: string
          valid_from?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "freight_quotes_superseded_by_quote_id_fkey"
            columns: ["superseded_by_quote_id"]
            isOneToOne: false
            referencedRelation: "freight_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_requirements: {
        Row: {
          cargo_class: string
          corridor: string | null
          created_at: string
          cross_border: boolean
          currency: string
          customer_id: string | null
          declared_value: number | null
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination_area_code: string | null
          destination_label: string
          destination_lat: number | null
          destination_lng: number | null
          enquiry_id: string | null
          equipment_required: string[]
          goods_code: string | null
          handling_requirements: string[]
          height_cm: number | null
          id: string
          is_test: boolean
          length_cm: number | null
          order_id: string | null
          origin_area_code: string | null
          origin_label: string
          origin_lat: number | null
          origin_lng: number | null
          package_count: number
          pickup_window_end: string
          pickup_window_start: string
          requested_by: string | null
          requirement_number: string
          service_level: string
          special_instructions: string | null
          state: Database["public"]["Enums"]["freight_requirement_state"]
          target_budget: number | null
          temperature_controlled: boolean
          temperature_max_c: number | null
          temperature_min_c: number | null
          tenant_id: string | null
          updated_at: string
          vehicle_type_required: string | null
          volume_cbm: number | null
          weight_kg: number
          width_cm: number | null
        }
        Insert: {
          cargo_class?: string
          corridor?: string | null
          created_at?: string
          cross_border?: boolean
          currency?: string
          customer_id?: string | null
          declared_value?: number | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_area_code?: string | null
          destination_label: string
          destination_lat?: number | null
          destination_lng?: number | null
          enquiry_id?: string | null
          equipment_required?: string[]
          goods_code?: string | null
          handling_requirements?: string[]
          height_cm?: number | null
          id?: string
          is_test?: boolean
          length_cm?: number | null
          order_id?: string | null
          origin_area_code?: string | null
          origin_label: string
          origin_lat?: number | null
          origin_lng?: number | null
          package_count?: number
          pickup_window_end: string
          pickup_window_start: string
          requested_by?: string | null
          requirement_number: string
          service_level?: string
          special_instructions?: string | null
          state?: Database["public"]["Enums"]["freight_requirement_state"]
          target_budget?: number | null
          temperature_controlled?: boolean
          temperature_max_c?: number | null
          temperature_min_c?: number | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_type_required?: string | null
          volume_cbm?: number | null
          weight_kg: number
          width_cm?: number | null
        }
        Update: {
          cargo_class?: string
          corridor?: string | null
          created_at?: string
          cross_border?: boolean
          currency?: string
          customer_id?: string | null
          declared_value?: number | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_area_code?: string | null
          destination_label?: string
          destination_lat?: number | null
          destination_lng?: number | null
          enquiry_id?: string | null
          equipment_required?: string[]
          goods_code?: string | null
          handling_requirements?: string[]
          height_cm?: number | null
          id?: string
          is_test?: boolean
          length_cm?: number | null
          order_id?: string | null
          origin_area_code?: string | null
          origin_label?: string
          origin_lat?: number | null
          origin_lng?: number | null
          package_count?: number
          pickup_window_end?: string
          pickup_window_start?: string
          requested_by?: string | null
          requirement_number?: string
          service_level?: string
          special_instructions?: string | null
          state?: Database["public"]["Enums"]["freight_requirement_state"]
          target_budget?: number | null
          temperature_controlled?: boolean
          temperature_max_c?: number | null
          temperature_min_c?: number | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_type_required?: string | null
          volume_cbm?: number | null
          weight_kg?: number
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_requirements_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "logistics_enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_requirements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_rfqs: {
        Row: {
          awarded_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          clarification_deadline: string | null
          created_at: string
          created_by: string | null
          currency: string
          evaluation_started_at: string | null
          id: string
          is_test: boolean
          issued_at: string | null
          opened_at: string | null
          policy_id: string | null
          requirement_id: string
          response_deadline: string
          rfq_number: string
          scope_notes: string | null
          sourcing_mode: string
          state: Database["public"]["Enums"]["tender_state"]
          target_budget: number | null
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          awarded_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          clarification_deadline?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          evaluation_started_at?: string | null
          id?: string
          is_test?: boolean
          issued_at?: string | null
          opened_at?: string | null
          policy_id?: string | null
          requirement_id: string
          response_deadline: string
          rfq_number: string
          scope_notes?: string | null
          sourcing_mode?: string
          state?: Database["public"]["Enums"]["tender_state"]
          target_budget?: number | null
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          awarded_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          clarification_deadline?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          evaluation_started_at?: string | null
          id?: string
          is_test?: boolean
          issued_at?: string | null
          opened_at?: string | null
          policy_id?: string | null
          requirement_id?: string
          response_deadline?: string
          rfq_number?: string
          scope_notes?: string | null
          sourcing_mode?: string
          state?: Database["public"]["Enums"]["tender_state"]
          target_budget?: number | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_rfqs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "freight_tender_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_rfqs_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "freight_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_settlement_lines: {
        Row: {
          adjustment_amount: number
          booking_id: string | null
          charge_id: string | null
          created_at: string
          description: string
          eligible_amount: number
          evidence: Json
          id: string
          net_amount: number
          settlement_id: string
        }
        Insert: {
          adjustment_amount?: number
          booking_id?: string | null
          charge_id?: string | null
          created_at?: string
          description: string
          eligible_amount?: number
          evidence?: Json
          id?: string
          net_amount?: number
          settlement_id: string
        }
        Update: {
          adjustment_amount?: number
          booking_id?: string | null
          charge_id?: string | null
          created_at?: string
          description?: string
          eligible_amount?: number
          evidence?: Json
          id?: string
          net_amount?: number
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_settlement_lines_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "freight_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_settlement_lines_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "freight_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_settlement_lines_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "freight_carrier_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_tender_policies: {
        Row: {
          active: boolean
          allow_lowest_price_only: boolean
          created_at: string
          created_by: string | null
          id: string
          max_award_variance_pct: number
          min_responses_to_award: number
          policy_code: string
          policy_label: string
          require_compliance_pass: boolean
          require_four_eyes_above: number | null
          updated_at: string
          weight_capacity: number
          weight_compliance: number
          weight_performance: number
          weight_price: number
          weight_transit: number
        }
        Insert: {
          active?: boolean
          allow_lowest_price_only?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          max_award_variance_pct?: number
          min_responses_to_award?: number
          policy_code: string
          policy_label: string
          require_compliance_pass?: boolean
          require_four_eyes_above?: number | null
          updated_at?: string
          weight_capacity?: number
          weight_compliance?: number
          weight_performance?: number
          weight_price?: number
          weight_transit?: number
        }
        Update: {
          active?: boolean
          allow_lowest_price_only?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          max_award_variance_pct?: number
          min_responses_to_award?: number
          policy_code?: string
          policy_label?: string
          require_compliance_pass?: boolean
          require_four_eyes_above?: number | null
          updated_at?: string
          weight_capacity?: number
          weight_compliance?: number
          weight_performance?: number
          weight_price?: number
          weight_transit?: number
        }
        Relationships: []
      }
      fx_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          from_amount_cents: number
          from_currency: string
          id: string
          journal_id: string | null
          rate_applied: number
          rate_id: string | null
          to_amount_cents: number
          to_currency: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_amount_cents: number
          from_currency: string
          id?: string
          journal_id?: string | null
          rate_applied: number
          rate_id?: string | null
          to_amount_cents: number
          to_currency: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_amount_cents?: number
          from_currency?: string
          id?: string
          journal_id?: string | null
          rate_applied?: number
          rate_id?: string | null
          to_amount_cents?: number
          to_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_transactions_from_currency_fkey"
            columns: ["from_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fx_transactions_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_transactions_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "exchange_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_transactions_to_currency_fkey"
            columns: ["to_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      invoice_collection_actions: {
        Row: {
          action_type: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          due_on: string
          id: string
          invoice_id: string
          note: string | null
          outcome: string | null
          owner_staff_id: string | null
          promised_amount_cents: number | null
          promised_on: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_type: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string
          id?: string
          invoice_id: string
          note?: string | null
          outcome?: string | null
          owner_staff_id?: string | null
          promised_amount_cents?: number | null
          promised_on?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string
          id?: string
          invoice_id?: string
          note?: string | null
          outcome?: string | null
          owner_staff_id?: string | null
          promised_amount_cents?: number | null
          promised_on?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_collection_actions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_collection_actions_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      journals: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_reason: string | null
          reverses_journal_id: string | null
          source: Database["public"]["Enums"]["journal_source"]
          status: Database["public"]["Enums"]["journal_status"]
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_reason?: string | null
          reverses_journal_id?: string | null
          source?: Database["public"]["Enums"]["journal_source"]
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_reason?: string | null
          reverses_journal_id?: string | null
          source?: Database["public"]["Enums"]["journal_source"]
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "journals_reverses_journal_id_fkey"
            columns: ["reverses_journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      journeys: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          customer_price_total: number
          ends_on: string | null
          id: string
          is_demo: boolean
          journey_code: string
          partner_customer_id: string | null
          partner_id: string
          partner_margin_total: number
          passengers: number
          starts_on: string | null
          status: string
          supplier_cost_total: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_price_total?: number
          ends_on?: string | null
          id?: string
          is_demo?: boolean
          journey_code?: string
          partner_customer_id?: string | null
          partner_id: string
          partner_margin_total?: number
          passengers?: number
          starts_on?: string | null
          status?: string
          supplier_cost_total?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_price_total?: number
          ends_on?: string | null
          id?: string
          is_demo?: boolean
          journey_code?: string
          partner_customer_id?: string | null
          partner_id?: string
          partner_margin_total?: number
          passengers?: number
          starts_on?: string | null
          status?: string
          supplier_cost_total?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journeys_partner_customer_id_fkey"
            columns: ["partner_customer_id"]
            isOneToOne: false
            referencedRelation: "partner_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          coa_code: string | null
          code: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["ledger_account_kind"]
          metadata: Json
          name: string
          updated_at: string
          wallet_id: string | null
        }
        Insert: {
          coa_code?: string | null
          code: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["ledger_account_kind"]
          metadata?: Json
          name: string
          updated_at?: string
          wallet_id?: string | null
        }
        Update: {
          coa_code?: string | null
          code?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["ledger_account_kind"]
          metadata?: Json
          name?: string
          updated_at?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account_id: string
          amount_cents: number
          base_amount_cents: number | null
          base_currency: string | null
          created_at: string
          currency: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          entry_hash: string | null
          fx_rate_id: string | null
          id: string
          journal_id: string
          memo: string | null
          posted_by: string | null
          prev_hash: string | null
          transaction_id: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          base_amount_cents?: number | null
          base_currency?: string | null
          created_at?: string
          currency?: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          entry_hash?: string | null
          fx_rate_id?: string | null
          id?: string
          journal_id: string
          memo?: string | null
          posted_by?: string | null
          prev_hash?: string | null
          transaction_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          base_amount_cents?: number | null
          base_currency?: string | null
          created_at?: string
          currency?: string
          direction?: Database["public"]["Enums"]["ledger_direction"]
          entry_hash?: string | null
          fx_rate_id?: string | null
          id?: string
          journal_id?: string
          memo?: string | null
          posted_by?: string | null
          prev_hash?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_fx_rate_id_fkey"
            columns: ["fx_rate_id"]
            isOneToOne: false
            referencedRelation: "exchange_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_snapshots: {
        Row: {
          account_id: string
          as_of: string
          balance_cents: number
          created_at: string
          created_by: string | null
          credits_cents: number
          currency: string
          debits_cents: number
          id: string
        }
        Insert: {
          account_id: string
          as_of: string
          balance_cents: number
          created_at?: string
          created_by?: string | null
          credits_cents: number
          currency: string
          debits_cents: number
          id?: string
        }
        Update: {
          account_id?: string
          as_of?: string
          balance_cents?: number
          created_at?: string
          created_by?: string | null
          credits_cents?: number
          currency?: string
          debits_cents?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_dispatch_requests: {
        Row: {
          assigned_driver_id: string | null
          assigned_vehicle_id: string | null
          consignment_id: string | null
          correlation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination_label: string
          destination_lat: number | null
          destination_lng: number | null
          hazardous: boolean
          id: string
          idempotency_key: string | null
          last_failure_code: string | null
          last_failure_message: string | null
          leg_id: string | null
          matching_status: string
          order_id: string | null
          origin_label: string
          origin_lat: number | null
          origin_lng: number | null
          pickup_window_end: string | null
          pickup_window_start: string | null
          priority: number
          quote_id: string | null
          request_kind: string
          request_number: string
          required_payload_kg: number
          required_volume_cbm: number
          reservation_id: string | null
          route_instance_id: string | null
          special_requirements: string[]
          status: string
          temperature_controlled: boolean
          updated_at: string
          vehicle_class: string
        }
        Insert: {
          assigned_driver_id?: string | null
          assigned_vehicle_id?: string | null
          consignment_id?: string | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_label: string
          destination_lat?: number | null
          destination_lng?: number | null
          hazardous?: boolean
          id?: string
          idempotency_key?: string | null
          last_failure_code?: string | null
          last_failure_message?: string | null
          leg_id?: string | null
          matching_status?: string
          order_id?: string | null
          origin_label: string
          origin_lat?: number | null
          origin_lng?: number | null
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          priority?: number
          quote_id?: string | null
          request_kind?: string
          request_number: string
          required_payload_kg: number
          required_volume_cbm?: number
          reservation_id?: string | null
          route_instance_id?: string | null
          special_requirements?: string[]
          status?: string
          temperature_controlled?: boolean
          updated_at?: string
          vehicle_class: string
        }
        Update: {
          assigned_driver_id?: string | null
          assigned_vehicle_id?: string | null
          consignment_id?: string | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_label?: string
          destination_lat?: number | null
          destination_lng?: number | null
          hazardous?: boolean
          id?: string
          idempotency_key?: string | null
          last_failure_code?: string | null
          last_failure_message?: string | null
          leg_id?: string | null
          matching_status?: string
          order_id?: string | null
          origin_label?: string
          origin_lat?: number | null
          origin_lng?: number | null
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          priority?: number
          quote_id?: string | null
          request_kind?: string
          request_number?: string
          required_payload_kg?: number
          required_volume_cbm?: number
          reservation_id?: string | null
          route_instance_id?: string | null
          special_requirements?: string[]
          status?: string
          temperature_controlled?: boolean
          updated_at?: string
          vehicle_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_dispatch_requests_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_dispatch_requests_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_dispatch_requests_consignment_id_fkey"
            columns: ["consignment_id"]
            isOneToOne: false
            referencedRelation: "freight_consignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_dispatch_requests_leg_id_fkey"
            columns: ["leg_id"]
            isOneToOne: false
            referencedRelation: "logistics_order_legs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_dispatch_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_dispatch_requests_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "freight_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_enquiries: {
        Row: {
          acknowledged_at: string | null
          budget_amount: number | null
          cargo_description: string
          closed_at: string | null
          company_name: string | null
          contact_email: string
          contact_name: string
          contact_phone: string | null
          contact_user_id: string | null
          created_at: string
          currency: string
          destination_label: string
          goods_code: string | null
          id: string
          is_test: boolean
          offering_code: string
          origin_label: string
          outcome: string | null
          owner_id: string | null
          reference: string
          requirements: string | null
          respond_by: string
          service_label: string | null
          shipment_frequency: string
          source_page: string | null
          spam_score: number
          status: string
          status_changed_at: string
          status_changed_by: string | null
          target_date: string | null
          triage_notes: string | null
          updated_at: string
          volume_cbm: number | null
          weight_kg: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          budget_amount?: number | null
          cargo_description: string
          closed_at?: string | null
          company_name?: string | null
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          contact_user_id?: string | null
          created_at?: string
          currency?: string
          destination_label: string
          goods_code?: string | null
          id?: string
          is_test?: boolean
          offering_code: string
          origin_label: string
          outcome?: string | null
          owner_id?: string | null
          reference?: string
          requirements?: string | null
          respond_by?: string
          service_label?: string | null
          shipment_frequency?: string
          source_page?: string | null
          spam_score?: number
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          target_date?: string | null
          triage_notes?: string | null
          updated_at?: string
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          budget_amount?: number | null
          cargo_description?: string
          closed_at?: string | null
          company_name?: string | null
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          contact_user_id?: string | null
          created_at?: string
          currency?: string
          destination_label?: string
          goods_code?: string | null
          id?: string
          is_test?: boolean
          offering_code?: string
          origin_label?: string
          outcome?: string | null
          owner_id?: string | null
          reference?: string
          requirements?: string | null
          respond_by?: string
          service_label?: string | null
          shipment_frequency?: string
          source_page?: string | null
          spam_score?: number
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          target_date?: string | null
          triage_notes?: string | null
          updated_at?: string
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      logistics_hubs: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          activation_reason: string | null
          active: boolean
          address: string | null
          capabilities: string[]
          capacity: Json
          capacity_unit: string
          city: string | null
          code: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country_code: string
          created_at: string
          created_by: string | null
          current_capacity: number
          dock_count: number
          handling_capacity_units_per_day: number | null
          hub_type: string
          id: string
          lat: number | null
          lng: number | null
          max_capacity: number | null
          max_weight_capacity_kg: number | null
          name: string
          notes: string | null
          operating_hours: Json
          region: string | null
          responsible_operator_id: string | null
          service_area: Json
          status: string
          storage_capacity_cbm: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason?: string | null
          active?: boolean
          address?: string | null
          capabilities?: string[]
          capacity?: Json
          capacity_unit?: string
          city?: string | null
          code: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          current_capacity?: number
          dock_count?: number
          handling_capacity_units_per_day?: number | null
          hub_type?: string
          id?: string
          lat?: number | null
          lng?: number | null
          max_capacity?: number | null
          max_weight_capacity_kg?: number | null
          name: string
          notes?: string | null
          operating_hours?: Json
          region?: string | null
          responsible_operator_id?: string | null
          service_area?: Json
          status?: string
          storage_capacity_cbm?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason?: string | null
          active?: boolean
          address?: string | null
          capabilities?: string[]
          capacity?: Json
          capacity_unit?: string
          city?: string | null
          code?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          current_capacity?: number
          dock_count?: number
          handling_capacity_units_per_day?: number | null
          hub_type?: string
          id?: string
          lat?: number | null
          lng?: number | null
          max_capacity?: number | null
          max_weight_capacity_kg?: number | null
          name?: string
          notes?: string | null
          operating_hours?: Json
          region?: string | null
          responsible_operator_id?: string | null
          service_area?: Json
          status?: string
          storage_capacity_cbm?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      logistics_manifests: {
        Row: {
          assigned_driver_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          destination_hub_id: string | null
          dispatched_at: string | null
          id: string
          manifest_number: string
          manifest_type: string
          notes: string | null
          origin_hub_id: string | null
          planned_departure: string | null
          received_at: string | null
          reconciled_at: string | null
          status: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          assigned_driver_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          destination_hub_id?: string | null
          dispatched_at?: string | null
          id?: string
          manifest_number?: string
          manifest_type?: string
          notes?: string | null
          origin_hub_id?: string | null
          planned_departure?: string | null
          received_at?: string | null
          reconciled_at?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          assigned_driver_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          destination_hub_id?: string | null
          dispatched_at?: string | null
          id?: string
          manifest_number?: string
          manifest_type?: string
          notes?: string | null
          origin_hub_id?: string | null
          planned_departure?: string | null
          received_at?: string | null
          reconciled_at?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_manifests_destination_hub_id_fkey"
            columns: ["destination_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_manifests_origin_hub_id_fkey"
            columns: ["origin_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_order_legs: {
        Row: {
          actual_arrival: string | null
          actual_departure: string | null
          actual_distance_km: number | null
          correlation_id: string | null
          created_at: string
          created_by: string | null
          destination_hub_id: string | null
          destination_kind: string
          destination_label: string
          destination_lat: number | null
          destination_lng: number | null
          driver_id: string | null
          eta: string | null
          exception_open: boolean
          id: string
          leg_no: number
          leg_type: string
          order_id: string
          origin_hub_id: string | null
          origin_kind: string
          origin_label: string
          origin_lat: number | null
          origin_lng: number | null
          planned_arrival: string | null
          planned_departure: string | null
          planned_distance_km: number | null
          route_id: string | null
          status: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_arrival?: string | null
          actual_departure?: string | null
          actual_distance_km?: number | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          destination_hub_id?: string | null
          destination_kind?: string
          destination_label: string
          destination_lat?: number | null
          destination_lng?: number | null
          driver_id?: string | null
          eta?: string | null
          exception_open?: boolean
          id?: string
          leg_no: number
          leg_type: string
          order_id: string
          origin_hub_id?: string | null
          origin_kind?: string
          origin_label: string
          origin_lat?: number | null
          origin_lng?: number | null
          planned_arrival?: string | null
          planned_departure?: string | null
          planned_distance_km?: number | null
          route_id?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_arrival?: string | null
          actual_departure?: string | null
          actual_distance_km?: number | null
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          destination_hub_id?: string | null
          destination_kind?: string
          destination_label?: string
          destination_lat?: number | null
          destination_lng?: number | null
          driver_id?: string | null
          eta?: string | null
          exception_open?: boolean
          id?: string
          leg_no?: number
          leg_type?: string
          order_id?: string
          origin_hub_id?: string | null
          origin_kind?: string
          origin_label?: string
          origin_lat?: number | null
          origin_lng?: number | null
          planned_arrival?: string | null
          planned_departure?: string | null
          planned_distance_km?: number | null
          route_id?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_order_legs_destination_hub_id_fkey"
            columns: ["destination_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_order_legs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_order_legs_origin_hub_id_fkey"
            columns: ["origin_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_order_legs_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_route_versions: {
        Row: {
          change_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          manual_override: boolean
          optimization_source: string
          parent_version_id: string | null
          plan_snapshot: Json
          route_id: string
          superseded_at: string | null
          version_number: number
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_override?: boolean
          optimization_source?: string
          parent_version_id?: string | null
          plan_snapshot?: Json
          route_id: string
          superseded_at?: string | null
          version_number: number
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_override?: boolean
          optimization_source?: string
          parent_version_id?: string | null
          plan_snapshot?: Json
          route_id?: string
          superseded_at?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "logistics_route_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "logistics_route_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_route_versions_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_routes: {
        Row: {
          actual_distance_km: number | null
          actual_duration_min: number | null
          actual_end: string | null
          actual_start: string | null
          created_at: string
          created_by: string | null
          current_version: number
          destination_hub_id: string | null
          destination_label: string | null
          destination_lat: number | null
          destination_lng: number | null
          driver_user_id: string | null
          estimated_duration_min: number | null
          id: string
          metadata: Json
          notes: string | null
          optimization_status: string
          organization_id: string | null
          origin_hub_id: string | null
          origin_label: string | null
          origin_lat: number | null
          origin_lng: number | null
          planned_distance_km: number | null
          planned_end: string | null
          planned_start: string | null
          required_capacity_kg: number | null
          required_vehicle_type: string | null
          route_number: string
          route_type: string
          service_window_end: string | null
          service_window_start: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          actual_distance_km?: number | null
          actual_duration_min?: number | null
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          destination_hub_id?: string | null
          destination_label?: string | null
          destination_lat?: number | null
          destination_lng?: number | null
          driver_user_id?: string | null
          estimated_duration_min?: number | null
          id?: string
          metadata?: Json
          notes?: string | null
          optimization_status?: string
          organization_id?: string | null
          origin_hub_id?: string | null
          origin_label?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          planned_distance_km?: number | null
          planned_end?: string | null
          planned_start?: string | null
          required_capacity_kg?: number | null
          required_vehicle_type?: string | null
          route_number: string
          route_type?: string
          service_window_end?: string | null
          service_window_start?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          actual_distance_km?: number | null
          actual_duration_min?: number | null
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          destination_hub_id?: string | null
          destination_label?: string | null
          destination_lat?: number | null
          destination_lng?: number | null
          driver_user_id?: string | null
          estimated_duration_min?: number | null
          id?: string
          metadata?: Json
          notes?: string | null
          optimization_status?: string
          organization_id?: string | null
          origin_hub_id?: string | null
          origin_label?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          planned_distance_km?: number | null
          planned_end?: string | null
          planned_start?: string | null
          required_capacity_kg?: number | null
          required_vehicle_type?: string | null
          route_number?: string
          route_type?: string
          service_window_end?: string | null
          service_window_start?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_routes_destination_hub_id_fkey"
            columns: ["destination_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_routes_origin_hub_id_fkey"
            columns: ["origin_hub_id"]
            isOneToOne: false
            referencedRelation: "logistics_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      mobility_orders: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          customer_price: number
          destination_label: string | null
          fees: number
          id: string
          idempotency_key: string | null
          is_demo: boolean
          journey_id: string | null
          leg_index: number
          order_code: string
          partner_customer_id: string | null
          partner_id: string | null
          partner_margin: number
          passengers: number
          pickup_label: string | null
          scheduled_at: string | null
          service_level: string | null
          service_type: Database["public"]["Enums"]["mobility_service_type"]
          special_requirements: string | null
          status: Database["public"]["Enums"]["mobility_order_status"]
          stops: Json
          supplier_cost: number
          taxes: number
          updated_at: string
          vehicle_class: string | null
          yalla_margin: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_price?: number
          destination_label?: string | null
          fees?: number
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          journey_id?: string | null
          leg_index?: number
          order_code?: string
          partner_customer_id?: string | null
          partner_id?: string | null
          partner_margin?: number
          passengers?: number
          pickup_label?: string | null
          scheduled_at?: string | null
          service_level?: string | null
          service_type?: Database["public"]["Enums"]["mobility_service_type"]
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["mobility_order_status"]
          stops?: Json
          supplier_cost?: number
          taxes?: number
          updated_at?: string
          vehicle_class?: string | null
          yalla_margin?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_price?: number
          destination_label?: string | null
          fees?: number
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          journey_id?: string | null
          leg_index?: number
          order_code?: string
          partner_customer_id?: string | null
          partner_id?: string | null
          partner_margin?: number
          passengers?: number
          pickup_label?: string | null
          scheduled_at?: string | null
          service_level?: string | null
          service_type?: Database["public"]["Enums"]["mobility_service_type"]
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["mobility_order_status"]
          stops?: Json
          supplier_cost?: number
          taxes?: number
          updated_at?: string
          vehicle_class?: string | null
          yalla_margin?: number
        }
        Relationships: [
          {
            foreignKeyName: "mobility_orders_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobility_orders_partner_customer_id_fkey"
            columns: ["partner_customer_id"]
            isOneToOne: false
            referencedRelation: "partner_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobility_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      mpesa_callback_logs: {
        Row: {
          checkout_request_id: string | null
          headers: Json | null
          id: string
          ip_address: unknown
          merchant_request_id: string | null
          payload: Json
          payment_attempt_id: string | null
          received_at: string
          verification_notes: string | null
          verified: boolean
        }
        Insert: {
          checkout_request_id?: string | null
          headers?: Json | null
          id?: string
          ip_address?: unknown
          merchant_request_id?: string | null
          payload: Json
          payment_attempt_id?: string | null
          received_at?: string
          verification_notes?: string | null
          verified?: boolean
        }
        Update: {
          checkout_request_id?: string | null
          headers?: Json | null
          id?: string
          ip_address?: unknown
          merchant_request_id?: string | null
          payload?: Json
          payment_attempt_id?: string | null
          received_at?: string
          verification_notes?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_callback_logs_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      mpesa_export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          download_url: string | null
          error_message: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: string
          id: string
          requested_by: string | null
          row_count: number | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          download_url?: string | null
          error_message?: string | null
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format: string
          id?: string
          requested_by?: string | null
          row_count?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          download_url?: string | null
          error_message?: string | null
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format?: string
          id?: string
          requested_by?: string | null
          row_count?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mpesa_idempotency_keys: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          idempotency_key: string
          request_hash: string
          response: Json | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          idempotency_key: string
          request_hash: string
          response?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      mpesa_payment_flags: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          payment_attempt_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          payment_attempt_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          payment_attempt_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_payment_flags_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      mpesa_rate_limit_buckets: {
        Row: {
          capacity: number
          last_refill_at: string
          refill_rate_per_sec: number
          shortcode: string
          tokens: number
          updated_at: string
        }
        Insert: {
          capacity?: number
          last_refill_at?: string
          refill_rate_per_sec?: number
          shortcode: string
          tokens?: number
          updated_at?: string
        }
        Update: {
          capacity?: number
          last_refill_at?: string
          refill_rate_per_sec?: number
          shortcode?: string
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      mpesa_reconciliation_runs: {
        Row: {
          checked_count: number
          completed_at: string | null
          created_at: string
          error_count: number
          id: string
          mismatch_count: number
          notes: Json
          reconciled_count: number
          started_at: string
          still_pending_count: number
          window_minutes: number
        }
        Insert: {
          checked_count?: number
          completed_at?: string | null
          created_at?: string
          error_count?: number
          id?: string
          mismatch_count?: number
          notes?: Json
          reconciled_count?: number
          started_at?: string
          still_pending_count?: number
          window_minutes?: number
        }
        Update: {
          checked_count?: number
          completed_at?: string | null
          created_at?: string
          error_count?: number
          id?: string
          mismatch_count?: number
          notes?: Json
          reconciled_count?: number
          started_at?: string
          still_pending_count?: number
          window_minutes?: number
        }
        Relationships: []
      }
      mpesa_stk_attempts: {
        Row: {
          account_reference: string | null
          amount_cents: number | null
          attempt_number: number
          checkout_request_id: string | null
          correlation_id: string | null
          created_at: string
          daraja_response: Json | null
          environment: string
          error_code: string | null
          error_message: string | null
          final_receipt: string | null
          final_result_code: number | null
          final_result_desc: string | null
          http_status: number | null
          id: string
          idempotency_key: string | null
          latency_ms: number | null
          merchant_request_id: string | null
          outcome: string
          payment_attempt_id: string | null
          phone_masked: string | null
          reconciled_at: string | null
          reconciliation_mismatch: boolean
          reconciliation_notes: string | null
          request_id: string | null
          shortcode: string | null
          user_id: string | null
          will_retry: boolean
        }
        Insert: {
          account_reference?: string | null
          amount_cents?: number | null
          attempt_number?: number
          checkout_request_id?: string | null
          correlation_id?: string | null
          created_at?: string
          daraja_response?: Json | null
          environment: string
          error_code?: string | null
          error_message?: string | null
          final_receipt?: string | null
          final_result_code?: number | null
          final_result_desc?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          latency_ms?: number | null
          merchant_request_id?: string | null
          outcome: string
          payment_attempt_id?: string | null
          phone_masked?: string | null
          reconciled_at?: string | null
          reconciliation_mismatch?: boolean
          reconciliation_notes?: string | null
          request_id?: string | null
          shortcode?: string | null
          user_id?: string | null
          will_retry?: boolean
        }
        Update: {
          account_reference?: string | null
          amount_cents?: number | null
          attempt_number?: number
          checkout_request_id?: string | null
          correlation_id?: string | null
          created_at?: string
          daraja_response?: Json | null
          environment?: string
          error_code?: string | null
          error_message?: string | null
          final_receipt?: string | null
          final_result_code?: number | null
          final_result_desc?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          latency_ms?: number | null
          merchant_request_id?: string | null
          outcome?: string
          payment_attempt_id?: string | null
          phone_masked?: string | null
          reconciled_at?: string | null
          reconciliation_mismatch?: boolean
          reconciliation_notes?: string | null
          request_id?: string | null
          shortcode?: string | null
          user_id?: string | null
          will_retry?: boolean
        }
        Relationships: []
      }
      mpesa_transactions: {
        Row: {
          account_reference: string | null
          amount_cents: number
          checkout_request_id: string | null
          created_at: string
          id: string
          merchant_request_id: string | null
          mpesa_receipt: string | null
          phone: string
          raw_callback: Json | null
          result_code: number | null
          result_desc: string | null
          status: Database["public"]["Enums"]["mpesa_status"]
          updated_at: string
          user_id: string
          wallet_id: string | null
          wallet_transaction_id: string | null
        }
        Insert: {
          account_reference?: string | null
          amount_cents: number
          checkout_request_id?: string | null
          created_at?: string
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          phone: string
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: Database["public"]["Enums"]["mpesa_status"]
          updated_at?: string
          user_id: string
          wallet_id?: string | null
          wallet_transaction_id?: string | null
        }
        Update: {
          account_reference?: string | null
          amount_cents?: number
          checkout_request_id?: string | null
          created_at?: string
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          phone?: string
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: Database["public"]["Enums"]["mpesa_status"]
          updated_at?: string
          user_id?: string
          wallet_id?: string | null
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mpesa_transactions_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_payment_attestations: {
        Row: {
          amount_cents: number
          attestation_note: string | null
          attested_by: string | null
          attested_by_identity: string
          collected_at: string
          created_at: string
          currency: string
          evidence_kind: string
          id: string
          method: string
          reference: string
          source: string
          transaction_id: string
          transaction_ref: string
        }
        Insert: {
          amount_cents: number
          attestation_note?: string | null
          attested_by?: string | null
          attested_by_identity: string
          collected_at?: string
          created_at?: string
          currency?: string
          evidence_kind?: string
          id?: string
          method: string
          reference: string
          source?: string
          transaction_id: string
          transaction_ref: string
        }
        Update: {
          amount_cents?: number
          attestation_note?: string | null
          attested_by?: string | null
          attested_by_identity?: string
          collected_at?: string
          created_at?: string
          currency?: string
          evidence_kind?: string
          id?: string
          method?: string
          reference?: string
          source?: string
          transaction_id?: string
          transaction_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_payment_attestations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "commercial_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_table: string
          id: string
          source_of_record: string | null
          source_record_id: string | null
          staff_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: string
          source_of_record?: string | null
          source_record_id?: string | null
          staff_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: string
          source_of_record?: string | null
          source_record_id?: string | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_audit_log_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      org_competencies: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          max_level: number
          name: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          max_level?: number
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          max_level?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_entities: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          legal_name: string
          logo_url: string | null
          notes: string | null
          operating_address: string | null
          operating_markets: string[]
          provenance: string
          registered_address: string | null
          registration_number: string | null
          seed_batch: string | null
          status: string
          tax_pin: string | null
          trading_name: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          legal_name: string
          logo_url?: string | null
          notes?: string | null
          operating_address?: string | null
          operating_markets?: string[]
          provenance?: string
          registered_address?: string | null
          registration_number?: string | null
          seed_batch?: string | null
          status?: string
          tax_pin?: string | null
          trading_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          legal_name?: string
          logo_url?: string | null
          notes?: string | null
          operating_address?: string | null
          operating_markets?: string[]
          provenance?: string
          registered_address?: string | null
          registration_number?: string | null
          seed_batch?: string | null
          status?: string
          tax_pin?: string | null
          trading_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      org_meetings: {
        Row: {
          account_id: string | null
          attendees: Json
          calendar_uid: string
          conference_provider: string | null
          created_at: string
          created_by: string | null
          duration_minutes: number
          external_calendar_id: string | null
          external_event_id: string | null
          failure_reason: string | null
          id: string
          interview_id: string | null
          invite_sent_at: string | null
          join_url: string | null
          meeting_kind: string
          organiser_email: string
          organiser_user_id: string | null
          platform: string
          provider_message_id: string | null
          purpose: string | null
          sequence: number
          starts_at: string
          status: string
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          attendees?: Json
          calendar_uid?: string
          conference_provider?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          external_calendar_id?: string | null
          external_event_id?: string | null
          failure_reason?: string | null
          id?: string
          interview_id?: string | null
          invite_sent_at?: string | null
          join_url?: string | null
          meeting_kind?: string
          organiser_email: string
          organiser_user_id?: string | null
          platform?: string
          provider_message_id?: string | null
          purpose?: string | null
          sequence?: number
          starts_at: string
          status?: string
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          attendees?: Json
          calendar_uid?: string
          conference_provider?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          external_calendar_id?: string | null
          external_event_id?: string | null
          failure_reason?: string | null
          id?: string
          interview_id?: string | null
          invite_sent_at?: string | null
          join_url?: string | null
          meeting_kind?: string
          organiser_email?: string
          organiser_user_id?: string | null
          platform?: string
          provider_message_id?: string | null
          purpose?: string | null
          sequence?: number
          starts_at?: string
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_objectives: {
        Row: {
          actual: number | null
          actual_recorded_at: string | null
          baseline: number | null
          created_at: string
          critical_min_pct: number | null
          cross_functional: boolean
          currency: string | null
          data_source: string | null
          deadline: string | null
          description: string | null
          evidence: Json
          formula: string | null
          id: string
          is_critical: boolean
          is_historical: boolean
          kpi_label: string
          kpi_unit: string
          level: string
          measurement_frequency: string | null
          org_id: string
          owner_staff_id: string | null
          parent_objective_id: string | null
          period_end: string | null
          period_start: string | null
          provenance: string
          review_frequency: string | null
          seed_batch: string | null
          source_type: string
          staff_id: string | null
          status: string
          target: number
          title: string
          unit_id: string | null
          updated_at: string
          weight_pct: number | null
        }
        Insert: {
          actual?: number | null
          actual_recorded_at?: string | null
          baseline?: number | null
          created_at?: string
          critical_min_pct?: number | null
          cross_functional?: boolean
          currency?: string | null
          data_source?: string | null
          deadline?: string | null
          description?: string | null
          evidence?: Json
          formula?: string | null
          id?: string
          is_critical?: boolean
          is_historical?: boolean
          kpi_label: string
          kpi_unit?: string
          level: string
          measurement_frequency?: string | null
          org_id: string
          owner_staff_id?: string | null
          parent_objective_id?: string | null
          period_end?: string | null
          period_start?: string | null
          provenance?: string
          review_frequency?: string | null
          seed_batch?: string | null
          source_type?: string
          staff_id?: string | null
          status?: string
          target: number
          title: string
          unit_id?: string | null
          updated_at?: string
          weight_pct?: number | null
        }
        Update: {
          actual?: number | null
          actual_recorded_at?: string | null
          baseline?: number | null
          created_at?: string
          critical_min_pct?: number | null
          cross_functional?: boolean
          currency?: string | null
          data_source?: string | null
          deadline?: string | null
          description?: string | null
          evidence?: Json
          formula?: string | null
          id?: string
          is_critical?: boolean
          is_historical?: boolean
          kpi_label?: string
          kpi_unit?: string
          level?: string
          measurement_frequency?: string | null
          org_id?: string
          owner_staff_id?: string | null
          parent_objective_id?: string | null
          period_end?: string | null
          period_start?: string | null
          provenance?: string
          review_frequency?: string | null
          seed_batch?: string | null
          source_type?: string
          staff_id?: string | null
          status?: string
          target?: number
          title?: string
          unit_id?: string | null
          updated_at?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "org_objectives_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_objectives_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_objectives_parent_objective_id_fkey"
            columns: ["parent_objective_id"]
            isOneToOne: false
            referencedRelation: "org_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_objectives_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_objectives_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      org_policies: {
        Row: {
          approver_staff_id: string | null
          category: string
          code: string
          created_at: string
          current_version: number
          effective_date: string | null
          id: string
          org_id: string
          owner_staff_id: string | null
          provenance: string
          purpose: string | null
          requires_acknowledgement: boolean
          review_date: string | null
          scope: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approver_staff_id?: string | null
          category?: string
          code: string
          created_at?: string
          current_version?: number
          effective_date?: string | null
          id?: string
          org_id: string
          owner_staff_id?: string | null
          provenance?: string
          purpose?: string | null
          requires_acknowledgement?: boolean
          review_date?: string | null
          scope?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          approver_staff_id?: string | null
          category?: string
          code?: string
          created_at?: string
          current_version?: number
          effective_date?: string | null
          id?: string
          org_id?: string
          owner_staff_id?: string | null
          provenance?: string
          purpose?: string | null
          requires_acknowledgement?: boolean
          review_date?: string | null
          scope?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_policies_approver_staff_id_fkey"
            columns: ["approver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policies_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      org_policy_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by_user: string | null
          id: string
          ip_address: string | null
          policy_id: string
          policy_version: number
          staff_id: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by_user?: string | null
          id?: string
          ip_address?: string | null
          policy_id: string
          policy_version: number
          staff_id: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by_user?: string | null
          id?: string
          ip_address?: string | null
          policy_id?: string
          policy_version?: number
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_policy_acknowledgements_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "org_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policy_acknowledgements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      org_policy_assignments: {
        Row: {
          created_at: string
          id: string
          platform_role: string | null
          policy_id: string
          position_id: string | null
          staff_id: string | null
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          platform_role?: string | null
          policy_id: string
          position_id?: string | null
          staff_id?: string | null
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          platform_role?: string | null
          policy_id?: string
          position_id?: string | null
          staff_id?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_policy_assignments_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "org_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policy_assignments_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "org_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policy_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_policy_assignments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      org_policy_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          authored_by: string | null
          body: string | null
          change_summary: string | null
          created_at: string
          id: string
          policy_id: string
          published_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          authored_by?: string | null
          body?: string | null
          change_summary?: string | null
          created_at?: string
          id?: string
          policy_id: string
          published_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          authored_by?: string | null
          body?: string | null
          change_summary?: string | null
          created_at?: string
          id?: string
          policy_id?: string
          published_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_policy_versions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "org_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      org_position_requirements: {
        Row: {
          competency_id: string | null
          created_at: string
          id: string
          label: string
          mandatory: boolean
          notes: string | null
          position_id: string
          required_level: number | null
          requirement_kind: string
          updated_at: string
        }
        Insert: {
          competency_id?: string | null
          created_at?: string
          id?: string
          label: string
          mandatory?: boolean
          notes?: string | null
          position_id: string
          required_level?: number | null
          requirement_kind: string
          updated_at?: string
        }
        Update: {
          competency_id?: string | null
          created_at?: string
          id?: string
          label?: string
          mandatory?: boolean
          notes?: string | null
          position_id?: string
          required_level?: number | null
          requirement_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_position_requirements_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "org_competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_position_requirements_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "org_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_positions: {
        Row: {
          approval_limit_cents: number | null
          approved_headcount: number
          authority: string[]
          code: string
          created_at: string
          grade: string | null
          id: string
          job_purpose: string | null
          kpis: Json
          platform_roles: string[]
          provenance: string
          reports_to_position_id: string | null
          responsibilities: string[]
          seed_batch: string | null
          status: string
          title: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          approval_limit_cents?: number | null
          approved_headcount?: number
          authority?: string[]
          code: string
          created_at?: string
          grade?: string | null
          id?: string
          job_purpose?: string | null
          kpis?: Json
          platform_roles?: string[]
          provenance?: string
          reports_to_position_id?: string | null
          responsibilities?: string[]
          seed_batch?: string | null
          status?: string
          title: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          approval_limit_cents?: number | null
          approved_headcount?: number
          authority?: string[]
          code?: string
          created_at?: string
          grade?: string | null
          id?: string
          job_purpose?: string | null
          kpis?: Json
          platform_roles?: string[]
          provenance?: string
          reports_to_position_id?: string | null
          responsibilities?: string[]
          seed_batch?: string | null
          status?: string
          title?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_positions_reports_to_position_id_fkey"
            columns: ["reports_to_position_id"]
            isOneToOne: false
            referencedRelation: "org_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_positions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      org_units: {
        Row: {
          approval_authority_cents: number | null
          budget_cents: number | null
          code: string
          cost_centre: string | null
          created_at: string
          currency: string
          head_staff_id: string | null
          id: string
          mandate: string | null
          name: string
          org_id: string
          parent_unit_id: string | null
          provenance: string
          purpose: string | null
          seed_batch: string | null
          sort_order: number
          status: string
          unit_type: string
          updated_at: string
        }
        Insert: {
          approval_authority_cents?: number | null
          budget_cents?: number | null
          code: string
          cost_centre?: string | null
          created_at?: string
          currency?: string
          head_staff_id?: string | null
          id?: string
          mandate?: string | null
          name: string
          org_id: string
          parent_unit_id?: string | null
          provenance?: string
          purpose?: string | null
          seed_batch?: string | null
          sort_order?: number
          status?: string
          unit_type?: string
          updated_at?: string
        }
        Update: {
          approval_authority_cents?: number | null
          budget_cents?: number | null
          code?: string
          cost_centre?: string | null
          created_at?: string
          currency?: string
          head_staff_id?: string | null
          id?: string
          mandate?: string | null
          name?: string
          org_id?: string
          parent_unit_id?: string | null
          provenance?: string
          purpose?: string | null
          seed_batch?: string | null
          sort_order?: number
          status?: string
          unit_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_units_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_units_parent_unit_id_fkey"
            columns: ["parent_unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          assigned_driver_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cold_chain: boolean
          created_at: string
          currency: string
          declared_value: number | null
          delivered_at: string | null
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          fragile: boolean
          height_cm: number | null
          id: string
          length_cm: number | null
          metadata: Json
          module: string
          order_id: string | null
          picked_up_at: string | null
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          recipient_name: string
          recipient_phone: string
          sender_id: string | null
          sender_name: string | null
          sender_phone: string | null
          status: string
          tracking_number: string
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          assigned_driver_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cold_chain?: boolean
          created_at?: string
          currency?: string
          declared_value?: number | null
          delivered_at?: string | null
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          fragile?: boolean
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          metadata?: Json
          module: string
          order_id?: string | null
          picked_up_at?: string | null
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          recipient_name: string
          recipient_phone: string
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          status?: string
          tracking_number?: string
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          assigned_driver_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cold_chain?: boolean
          created_at?: string
          currency?: string
          declared_value?: number | null
          delivered_at?: string | null
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          fragile?: boolean
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          metadata?: Json
          module?: string
          order_id?: string | null
          picked_up_at?: string | null
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          recipient_name?: string
          recipient_phone?: string
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          status?: string
          tracking_number?: string
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "delivery_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_customers: {
        Row: {
          accessibility_needs: string | null
          created_at: string
          created_by: string | null
          customer_reference: string | null
          email: string | null
          full_name: string
          id: string
          is_demo: boolean
          lifetime_spend: number
          organisation: string | null
          outstanding_balance: number
          partner_id: string
          phone: string | null
          preferences: Json
          updated_at: string
        }
        Insert: {
          accessibility_needs?: string | null
          created_at?: string
          created_by?: string | null
          customer_reference?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_demo?: boolean
          lifetime_spend?: number
          organisation?: string | null
          outstanding_balance?: number
          partner_id: string
          phone?: string | null
          preferences?: Json
          updated_at?: string
        }
        Update: {
          accessibility_needs?: string | null
          created_at?: string
          created_by?: string | null
          customer_reference?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_demo?: boolean
          lifetime_spend?: number
          organisation?: string | null
          outstanding_balance?: number
          partner_id?: string
          phone?: string | null
          preferences?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_customers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_ledger_entries: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          created_by: string | null
          currency: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          entry_kind: Database["public"]["Enums"]["partner_ledger_kind"]
          id: string
          idempotency_key: string | null
          journey_id: string | null
          memo: string | null
          order_id: string | null
          partner_id: string
          reference: string | null
          settlement_id: string | null
          wallet_id: string | null
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          entry_kind: Database["public"]["Enums"]["partner_ledger_kind"]
          id?: string
          idempotency_key?: string | null
          journey_id?: string | null
          memo?: string | null
          order_id?: string | null
          partner_id: string
          reference?: string | null
          settlement_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction?: Database["public"]["Enums"]["ledger_direction"]
          entry_kind?: Database["public"]["Enums"]["partner_ledger_kind"]
          id?: string
          idempotency_key?: string | null
          journey_id?: string | null
          memo?: string | null
          order_id?: string | null
          partner_id?: string
          reference?: string | null
          settlement_id?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_ledger_entries_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "mobility_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_ledger_entries_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_ledger_entries_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "partner_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_settlement_lines: {
        Row: {
          created_at: string
          customer_price: number
          id: string
          order_id: string
          partner_id: string
          partner_margin: number
          settlement_id: string
          supplier_cost: number
          taxes: number
          yalla_margin: number
        }
        Insert: {
          created_at?: string
          customer_price?: number
          id?: string
          order_id: string
          partner_id: string
          partner_margin?: number
          settlement_id: string
          supplier_cost?: number
          taxes?: number
          yalla_margin?: number
        }
        Update: {
          created_at?: string
          customer_price?: number
          id?: string
          order_id?: string
          partner_id?: string
          partner_margin?: number
          settlement_id?: string
          supplier_cost?: number
          taxes?: number
          yalla_margin?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_settlement_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "mobility_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_settlement_lines_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_settlement_lines_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "partner_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          currency: string
          generated_by: string | null
          gross_value: number
          id: string
          notes: string | null
          orders_count: number
          paid_amount: number | null
          paid_at: string | null
          partner_id: string
          partner_margin: number
          payment_reference: string | null
          payout_amount: number
          period_end: string
          period_start: string
          reconciled_at: string | null
          settlement_code: string
          status: Database["public"]["Enums"]["partner_settlement_state"]
          supplier_cost: number
          taxes: number
          updated_at: string
          variance_amount: number | null
          yalla_margin: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          generated_by?: string | null
          gross_value?: number
          id?: string
          notes?: string | null
          orders_count?: number
          paid_amount?: number | null
          paid_at?: string | null
          partner_id: string
          partner_margin?: number
          payment_reference?: string | null
          payout_amount?: number
          period_end: string
          period_start: string
          reconciled_at?: string | null
          settlement_code: string
          status?: Database["public"]["Enums"]["partner_settlement_state"]
          supplier_cost?: number
          taxes?: number
          updated_at?: string
          variance_amount?: number | null
          yalla_margin?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          generated_by?: string | null
          gross_value?: number
          id?: string
          notes?: string | null
          orders_count?: number
          paid_amount?: number | null
          paid_at?: string | null
          partner_id?: string
          partner_margin?: number
          payment_reference?: string | null
          payout_amount?: number
          period_end?: string
          period_start?: string
          reconciled_at?: string | null
          settlement_code?: string
          status?: Database["public"]["Enums"]["partner_settlement_state"]
          supplier_cost?: number
          taxes?: number
          updated_at?: string
          variance_amount?: number | null
          yalla_margin?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_settlements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_wallets: {
        Row: {
          balance: number
          created_at: string
          credit_limit: number
          currency: string
          id: string
          is_prefunded: boolean
          low_balance_threshold: number
          partner_id: string
          reserved: number
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          credit_limit?: number
          currency?: string
          id?: string
          is_prefunded?: boolean
          low_balance_threshold?: number
          partner_id: string
          reserved?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          credit_limit?: number
          currency?: string
          id?: string
          is_prefunded?: boolean
          low_balance_threshold?: number
          partner_id?: string
          reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_wallets_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          activated_at: string | null
          api_access: boolean
          city: string | null
          commercial_model: Database["public"]["Enums"]["partner_commercial_model"]
          commission_model: Database["public"]["Enums"]["partner_commission_model"]
          contract_signed_at: string | null
          corporate_account_id: string | null
          country: string
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          legal_name: string
          notes: string | null
          onboarding_stage: Database["public"]["Enums"]["partner_onboarding_stage"]
          partner_code: string
          partner_margin_pct: number
          partner_type: Database["public"]["Enums"]["partner_type"]
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          risk_score: number
          status: Database["public"]["Enums"]["partner_status"]
          trading_name: string | null
          trust_score: number
          updated_at: string
          verification_status: Database["public"]["Enums"]["partner_verification_status"]
          white_label: boolean
        }
        Insert: {
          activated_at?: string | null
          api_access?: boolean
          city?: string | null
          commercial_model?: Database["public"]["Enums"]["partner_commercial_model"]
          commission_model?: Database["public"]["Enums"]["partner_commission_model"]
          contract_signed_at?: string | null
          corporate_account_id?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          legal_name: string
          notes?: string | null
          onboarding_stage?: Database["public"]["Enums"]["partner_onboarding_stage"]
          partner_code: string
          partner_margin_pct?: number
          partner_type?: Database["public"]["Enums"]["partner_type"]
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          risk_score?: number
          status?: Database["public"]["Enums"]["partner_status"]
          trading_name?: string | null
          trust_score?: number
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["partner_verification_status"]
          white_label?: boolean
        }
        Update: {
          activated_at?: string | null
          api_access?: boolean
          city?: string | null
          commercial_model?: Database["public"]["Enums"]["partner_commercial_model"]
          commission_model?: Database["public"]["Enums"]["partner_commission_model"]
          contract_signed_at?: string | null
          corporate_account_id?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          legal_name?: string
          notes?: string | null
          onboarding_stage?: Database["public"]["Enums"]["partner_onboarding_stage"]
          partner_code?: string
          partner_margin_pct?: number
          partner_type?: Database["public"]["Enums"]["partner_type"]
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          risk_score?: number
          status?: Database["public"]["Enums"]["partner_status"]
          trading_name?: string | null
          trust_score?: number
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["partner_verification_status"]
          white_label?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "partners_corporate_account_id_fkey"
            columns: ["corporate_account_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_note: string | null
          alert_key: string
          details: Json
          fired_at: string
          id: string
          message: string
          pagerduty_dedup_key: string | null
          pagerduty_delivered: boolean
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          slo_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_note?: string | null
          alert_key: string
          details?: Json
          fired_at?: string
          id?: string
          message: string
          pagerduty_dedup_key?: string | null
          pagerduty_delivered?: boolean
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          slo_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_note?: string | null
          alert_key?: string
          details?: Json
          fired_at?: string
          id?: string
          message?: string
          pagerduty_dedup_key?: string | null
          pagerduty_delivered?: boolean
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          slo_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_alerts_slo_id_fkey"
            columns: ["slo_id"]
            isOneToOne: false
            referencedRelation: "payment_slos"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          accepted_at: string | null
          account_reference: string
          amount_cents: number
          checkout_request_id: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string
          ip_address: unknown
          merchant_request_id: string | null
          metadata: Json
          mpesa_receipt_number: string | null
          phone: string
          provider: string
          receiving_account: string | null
          request_id: string | null
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
          user_agent: string | null
          user_id: string
          wallet_id: string
          wallet_posted: boolean
        }
        Insert: {
          accepted_at?: string | null
          account_reference: string
          amount_cents: number
          checkout_request_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          initiated_at?: string
          ip_address?: unknown
          merchant_request_id?: string | null
          metadata?: Json
          mpesa_receipt_number?: string | null
          phone: string
          provider?: string
          receiving_account?: string | null
          request_id?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
          user_agent?: string | null
          user_id: string
          wallet_id: string
          wallet_posted?: boolean
        }
        Update: {
          accepted_at?: string | null
          account_reference?: string
          amount_cents?: number
          checkout_request_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          initiated_at?: string
          ip_address?: unknown
          merchant_request_id?: string | null
          metadata?: Json
          mpesa_receipt_number?: string | null
          phone?: string
          provider?: string
          receiving_account?: string | null
          request_id?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          wallet_id?: string
          wallet_posted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_audit_logs: {
        Row: {
          actor_id: string | null
          actor_type: string
          audit_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["payment_audit_event"]
          ip_address: unknown
          new_value: Json | null
          old_value: Json | null
          transaction_id: string
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          audit_id?: string
          created_at?: string
          event_type: Database["public"]["Enums"]["payment_audit_event"]
          ip_address?: unknown
          new_value?: Json | null
          old_value?: Json | null
          transaction_id: string
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          audit_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["payment_audit_event"]
          ip_address?: unknown
          new_value?: Json | null
          old_value?: Json | null
          transaction_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_audit_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_audit_logs_v2: {
        Row: {
          action: string
          actor: string
          actor_user_id: string | null
          after_state: Database["public"]["Enums"]["payment_state"] | null
          before_state: Database["public"]["Enums"]["payment_state"] | null
          correlation_id: string | null
          created_at: string
          headers: Json | null
          id: string
          ip_address: unknown
          jwt_claims: Json | null
          payload: Json | null
          payment_attempt_id: string | null
          request_id: string | null
        }
        Insert: {
          action: string
          actor: string
          actor_user_id?: string | null
          after_state?: Database["public"]["Enums"]["payment_state"] | null
          before_state?: Database["public"]["Enums"]["payment_state"] | null
          correlation_id?: string | null
          created_at?: string
          headers?: Json | null
          id?: string
          ip_address?: unknown
          jwt_claims?: Json | null
          payload?: Json | null
          payment_attempt_id?: string | null
          request_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          actor_user_id?: string | null
          after_state?: Database["public"]["Enums"]["payment_state"] | null
          before_state?: Database["public"]["Enums"]["payment_state"] | null
          correlation_id?: string | null
          created_at?: string
          headers?: Json | null
          id?: string
          ip_address?: unknown
          jwt_claims?: Json | null
          payload?: Json | null
          payment_attempt_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_audit_logs_v2_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_callback_certifications: {
        Row: {
          certification_run_id: string | null
          certified_at: string
          correlation_id: string
          created_at: string
          duration_ms: number | null
          error: string | null
          evidence: Json
          id: string
          stage: string
          status: string
        }
        Insert: {
          certification_run_id?: string | null
          certified_at?: string
          correlation_id: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          evidence?: Json
          id?: string
          stage: string
          status?: string
        }
        Update: {
          certification_run_id?: string | null
          certified_at?: string
          correlation_id?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          evidence?: Json
          id?: string
          stage?: string
          status?: string
        }
        Relationships: []
      }
      payment_certification_baselines: {
        Row: {
          certified_at: string
          created_at: string
          deployment_version: string | null
          environment: string
          git_revision: string | null
          id: string
          metrics: Json
          overall_score: number | null
          readiness_score: number | null
          run_id: string | null
          signal_scores: Json
          suite_version: string | null
          updated_at: string
        }
        Insert: {
          certified_at?: string
          created_at?: string
          deployment_version?: string | null
          environment: string
          git_revision?: string | null
          id?: string
          metrics?: Json
          overall_score?: number | null
          readiness_score?: number | null
          run_id?: string | null
          signal_scores?: Json
          suite_version?: string | null
          updated_at?: string
        }
        Update: {
          certified_at?: string
          created_at?: string
          deployment_version?: string | null
          environment?: string
          git_revision?: string | null
          id?: string
          metrics?: Json
          overall_score?: number | null
          readiness_score?: number | null
          run_id?: string | null
          signal_scores?: Json
          suite_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_certification_baselines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payment_certification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_certification_controls: {
        Row: {
          code: string
          control_group: string
          created_at: string
          environment: string | null
          evidence: Json
          expectation: string
          last_run_at: string | null
          observation: string | null
          title: string
          updated_at: string
          verdict: string
        }
        Insert: {
          code: string
          control_group: string
          created_at?: string
          environment?: string | null
          evidence?: Json
          expectation: string
          last_run_at?: string | null
          observation?: string | null
          title: string
          updated_at?: string
          verdict?: string
        }
        Update: {
          code?: string
          control_group?: string
          created_at?: string
          environment?: string | null
          evidence?: Json
          expectation?: string
          last_run_at?: string | null
          observation?: string | null
          title?: string
          updated_at?: string
          verdict?: string
        }
        Relationships: []
      }
      payment_certification_forensics: {
        Row: {
          classified_at: string
          correlation_id: string | null
          created_at: string
          db_mutation: Json
          edge_function: string | null
          evidence: Json
          failure_class: string
          id: string
          recommended_fix: string
          rpc_name: string | null
          run_id: string
          scenario_id: string
          scenario_key: string
          stage: string
          trace_id: string | null
        }
        Insert: {
          classified_at?: string
          correlation_id?: string | null
          created_at?: string
          db_mutation?: Json
          edge_function?: string | null
          evidence?: Json
          failure_class: string
          id?: string
          recommended_fix: string
          rpc_name?: string | null
          run_id: string
          scenario_id: string
          scenario_key: string
          stage: string
          trace_id?: string | null
        }
        Update: {
          classified_at?: string
          correlation_id?: string | null
          created_at?: string
          db_mutation?: Json
          edge_function?: string | null
          evidence?: Json
          failure_class?: string
          id?: string
          recommended_fix?: string
          rpc_name?: string | null
          run_id?: string
          scenario_id?: string
          scenario_key?: string
          stage?: string
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_certification_forensics_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: true
            referencedRelation: "payment_certification_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_certification_regressions: {
        Row: {
          last_run_id: string | null
          last_verified_at: string | null
          last_verify_status: string | null
          pinned_at: string
          pinned_by: string | null
          pinned_fingerprint: Json
          scenario_key: string
          updated_at: string
        }
        Insert: {
          last_run_id?: string | null
          last_verified_at?: string | null
          last_verify_status?: string | null
          pinned_at?: string
          pinned_by?: string | null
          pinned_fingerprint: Json
          scenario_key: string
          updated_at?: string
        }
        Update: {
          last_run_id?: string | null
          last_verified_at?: string | null
          last_verify_status?: string | null
          pinned_at?: string
          pinned_by?: string | null
          pinned_fingerprint?: Json
          scenario_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_certification_runs: {
        Row: {
          build_timestamp: string | null
          completed_at: string | null
          created_at: string
          deployment_version: string | null
          environment: string
          failed_scenarios: number
          git_revision: string | null
          id: string
          overall_score: number | null
          passed_scenarios: number
          skipped_scenarios: number
          started_at: string
          status: string
          suite_version: string
          summary: Json
          total_scenarios: number
          triggered_by: string | null
        }
        Insert: {
          build_timestamp?: string | null
          completed_at?: string | null
          created_at?: string
          deployment_version?: string | null
          environment?: string
          failed_scenarios?: number
          git_revision?: string | null
          id?: string
          overall_score?: number | null
          passed_scenarios?: number
          skipped_scenarios?: number
          started_at?: string
          status?: string
          suite_version?: string
          summary?: Json
          total_scenarios?: number
          triggered_by?: string | null
        }
        Update: {
          build_timestamp?: string | null
          completed_at?: string | null
          created_at?: string
          deployment_version?: string | null
          environment?: string
          failed_scenarios?: number
          git_revision?: string | null
          id?: string
          overall_score?: number | null
          passed_scenarios?: number
          skipped_scenarios?: number
          started_at?: string
          status?: string
          suite_version?: string
          summary?: Json
          total_scenarios?: number
          triggered_by?: string | null
        }
        Relationships: []
      }
      payment_certification_safeguards: {
        Row: {
          cooldown_minutes_after_failure: number
          exclude_synthetic_from_facts: boolean
          id: boolean
          max_concurrent_runs: number
          max_runs_per_hour: number
          stale_run_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cooldown_minutes_after_failure?: number
          exclude_synthetic_from_facts?: boolean
          id?: boolean
          max_concurrent_runs?: number
          max_runs_per_hour?: number
          stale_run_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cooldown_minutes_after_failure?: number
          exclude_synthetic_from_facts?: boolean
          id?: boolean
          max_concurrent_runs?: number
          max_runs_per_hour?: number
          stale_run_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_certification_scenarios: {
        Row: {
          checkout_request_id: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          evidence: Json
          expected_outcome: string
          gate_results: Json
          id: string
          merchant_request_id: string | null
          observed_outcome: string | null
          payment_attempt_id: string | null
          run_id: string
          scenario_key: string
          scenario_name: string
          started_at: string
          status: string
        }
        Insert: {
          checkout_request_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          evidence?: Json
          expected_outcome: string
          gate_results?: Json
          id?: string
          merchant_request_id?: string | null
          observed_outcome?: string | null
          payment_attempt_id?: string | null
          run_id: string
          scenario_key: string
          scenario_name: string
          started_at?: string
          status?: string
        }
        Update: {
          checkout_request_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          evidence?: Json
          expected_outcome?: string
          gate_results?: Json
          id?: string
          merchant_request_id?: string | null
          observed_outcome?: string | null
          payment_attempt_id?: string | null
          run_id?: string
          scenario_key?: string
          scenario_name?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_certification_scenarios_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payment_certification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_chaos_runs: {
        Row: {
          auto_recovered: boolean
          correlation_id: string | null
          created_at: string
          data_loss_detected: boolean
          evidence: Json
          financial_integrity_delta: number
          finished_at: string | null
          id: string
          recovery_ms: number | null
          scenario_id: string
          started_at: string
          status: string
        }
        Insert: {
          auto_recovered?: boolean
          correlation_id?: string | null
          created_at?: string
          data_loss_detected?: boolean
          evidence?: Json
          financial_integrity_delta?: number
          finished_at?: string | null
          id?: string
          recovery_ms?: number | null
          scenario_id: string
          started_at?: string
          status?: string
        }
        Update: {
          auto_recovered?: boolean
          correlation_id?: string | null
          created_at?: string
          data_loss_detected?: boolean
          evidence?: Json
          financial_integrity_delta?: number
          finished_at?: string | null
          id?: string
          recovery_ms?: number | null
          scenario_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_chaos_runs_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "payment_chaos_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_chaos_scenarios: {
        Row: {
          created_at: string
          description: string
          display_name: string
          enabled: boolean
          fault_category: string
          id: string
          max_recovery_ms: number
          scenario_key: string
        }
        Insert: {
          created_at?: string
          description: string
          display_name: string
          enabled?: boolean
          fault_category: string
          id?: string
          max_recovery_ms?: number
          scenario_key: string
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          enabled?: boolean
          fault_category?: string
          id?: string
          max_recovery_ms?: number
          scenario_key?: string
        }
        Relationships: []
      }
      payment_circuit_breakers: {
        Row: {
          failure_count: number
          last_error: string | null
          opened_at: string | null
          reopens_at: string | null
          service: string
          state: string
          success_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          failure_count?: number
          last_error?: string | null
          opened_at?: string | null
          reopens_at?: string | null
          service: string
          state?: string
          success_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          failure_count?: number
          last_error?: string | null
          opened_at?: string | null
          reopens_at?: string | null
          service?: string
          state?: string
          success_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      payment_confidence_reports: {
        Row: {
          can_process_production_money: boolean
          confidence_pct: number
          created_at: string
          generated_at: string
          id: string
          metrics: Json
          reasons: Json
          signature: string | null
          window_end: string
          window_start: string
        }
        Insert: {
          can_process_production_money: boolean
          confidence_pct: number
          created_at?: string
          generated_at?: string
          id?: string
          metrics?: Json
          reasons?: Json
          signature?: string | null
          window_end: string
          window_start: string
        }
        Update: {
          can_process_production_money?: boolean
          confidence_pct?: number
          created_at?: string
          generated_at?: string
          id?: string
          metrics?: Json
          reasons?: Json
          signature?: string | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      payment_config_baseline: {
        Row: {
          approved_by: string | null
          captured_at: string
          created_at: string
          fingerprint: string
          id: string
          is_current: boolean
          surface: Json
        }
        Insert: {
          approved_by?: string | null
          captured_at?: string
          created_at?: string
          fingerprint: string
          id?: string
          is_current?: boolean
          surface?: Json
        }
        Update: {
          approved_by?: string | null
          captured_at?: string
          created_at?: string
          fingerprint?: string
          id?: string
          is_current?: boolean
          surface?: Json
        }
        Relationships: []
      }
      payment_config_certifications: {
        Row: {
          checks: Json
          created_at: string
          drift_from_baseline: Json
          failure_reason: string | null
          fingerprint: string
          id: string
          passed: boolean
          ran_at: string
        }
        Insert: {
          checks?: Json
          created_at?: string
          drift_from_baseline?: Json
          failure_reason?: string | null
          fingerprint: string
          id?: string
          passed: boolean
          ran_at?: string
        }
        Update: {
          checks?: Json
          created_at?: string
          drift_from_baseline?: Json
          failure_reason?: string | null
          fingerprint?: string
          id?: string
          passed?: boolean
          ran_at?: string
        }
        Relationships: []
      }
      payment_continuous_qualification_reruns: {
        Row: {
          completed_at: string | null
          created_at: string
          error_detail: string | null
          id: string
          new_run_id: string | null
          original_run_id: string
          reason: string
          requested_by: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_detail?: string | null
          id?: string
          new_run_id?: string | null
          original_run_id: string
          reason: string
          requested_by: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_detail?: string | null
          id?: string
          new_run_id?: string | null
          original_run_id?: string
          reason?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_continuous_qualification_reruns_new_run_id_fkey"
            columns: ["new_run_id"]
            isOneToOne: false
            referencedRelation: "payment_continuous_qualification_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_continuous_qualification_reruns_original_run_id_fkey"
            columns: ["original_run_id"]
            isOneToOne: false
            referencedRelation: "payment_continuous_qualification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_continuous_qualification_runs: {
        Row: {
          cert_run_id: string | null
          chain_key: string
          completed_at: string | null
          correlation_id: string | null
          correlation_ids: string[] | null
          created_at: string
          error: string | null
          evidence_pack_id: string | null
          failed_steps: number | null
          failure_class: string | null
          financial_integrity_score: number | null
          forensic_bundle: Json | null
          id: string
          passed_steps: number | null
          readiness_score: number | null
          reliability_score: number | null
          status: string
          total_steps: number | null
          triggered_at: string
          triggered_by: string
        }
        Insert: {
          cert_run_id?: string | null
          chain_key?: string
          completed_at?: string | null
          correlation_id?: string | null
          correlation_ids?: string[] | null
          created_at?: string
          error?: string | null
          evidence_pack_id?: string | null
          failed_steps?: number | null
          failure_class?: string | null
          financial_integrity_score?: number | null
          forensic_bundle?: Json | null
          id?: string
          passed_steps?: number | null
          readiness_score?: number | null
          reliability_score?: number | null
          status?: string
          total_steps?: number | null
          triggered_at?: string
          triggered_by?: string
        }
        Update: {
          cert_run_id?: string | null
          chain_key?: string
          completed_at?: string | null
          correlation_id?: string | null
          correlation_ids?: string[] | null
          created_at?: string
          error?: string | null
          evidence_pack_id?: string | null
          failed_steps?: number | null
          failure_class?: string | null
          financial_integrity_score?: number | null
          forensic_bundle?: Json | null
          id?: string
          passed_steps?: number | null
          readiness_score?: number | null
          reliability_score?: number | null
          status?: string
          total_steps?: number | null
          triggered_at?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_continuous_qualification_runs_evidence_pack_id_fkey"
            columns: ["evidence_pack_id"]
            isOneToOne: false
            referencedRelation: "payment_qualification_evidence_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_continuous_qualification_runs_failure_class_fkey"
            columns: ["failure_class"]
            isOneToOne: false
            referencedRelation: "payment_qualification_failure_classes"
            referencedColumns: ["class_key"]
          },
        ]
      }
      payment_dead_letters: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          payload: Json
          payment_attempt_id: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          payload: Json
          payment_attempt_id?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          payload?: Json
          payment_attempt_id?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_dead_letters_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_decision_trees: {
        Row: {
          built_at: string
          confidence: number | null
          created_at: string
          decision_id: string
          historical_comparison: Json | null
          id: string
          recommendations: Json
          root_verdict: string
          tree: Json
        }
        Insert: {
          built_at?: string
          confidence?: number | null
          created_at?: string
          decision_id: string
          historical_comparison?: Json | null
          id?: string
          recommendations?: Json
          root_verdict: string
          tree: Json
        }
        Update: {
          built_at?: string
          confidence?: number | null
          created_at?: string
          decision_id?: string
          historical_comparison?: Json | null
          id?: string
          recommendations?: Json
          root_verdict?: string
          tree?: Json
        }
        Relationships: []
      }
      payment_disputes: {
        Row: {
          amount_cents: number
          corporate_id: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          raised_by: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          corporate_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          raised_by: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          corporate_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          raised_by?: string
          reason?: Database["public"]["Enums"]["dispute_reason"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["payment_event_type"]
          payload: Json
          transaction_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          event_id?: string
          event_type: Database["public"]["Enums"]["payment_event_type"]
          payload?: Json
          transaction_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["payment_event_type"]
          payload?: Json
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_evidence_exports: {
        Row: {
          bundle: Json
          bundle_sha256: string | null
          canonical_payload_sha256: string | null
          canonicalization_version: string | null
          certification_run_id: string | null
          correlation_id: string | null
          deployment_version: string | null
          evidence_signature: string | null
          evidence_version: string
          git_revision: string | null
          id: string
          identifier_kind: string
          identifier_value: string
          migration_version: string | null
          package_format: string | null
          readiness_snapshot: Json | null
          reliability_score: number | null
          requested_at: string
          requested_by: string | null
          rollout_percent: number | null
          row_count: number | null
          runner_version: string | null
          schema_version: string | null
          signature_algorithm: string | null
          signature_sha256: string | null
          signed_manifest: Json | null
          signer_key_id: string | null
          signing_key_id: string | null
          status: string
          verification_last_at: string | null
          verification_verdict: string | null
        }
        Insert: {
          bundle?: Json
          bundle_sha256?: string | null
          canonical_payload_sha256?: string | null
          canonicalization_version?: string | null
          certification_run_id?: string | null
          correlation_id?: string | null
          deployment_version?: string | null
          evidence_signature?: string | null
          evidence_version?: string
          git_revision?: string | null
          id?: string
          identifier_kind: string
          identifier_value: string
          migration_version?: string | null
          package_format?: string | null
          readiness_snapshot?: Json | null
          reliability_score?: number | null
          requested_at?: string
          requested_by?: string | null
          rollout_percent?: number | null
          row_count?: number | null
          runner_version?: string | null
          schema_version?: string | null
          signature_algorithm?: string | null
          signature_sha256?: string | null
          signed_manifest?: Json | null
          signer_key_id?: string | null
          signing_key_id?: string | null
          status?: string
          verification_last_at?: string | null
          verification_verdict?: string | null
        }
        Update: {
          bundle?: Json
          bundle_sha256?: string | null
          canonical_payload_sha256?: string | null
          canonicalization_version?: string | null
          certification_run_id?: string | null
          correlation_id?: string | null
          deployment_version?: string | null
          evidence_signature?: string | null
          evidence_version?: string
          git_revision?: string | null
          id?: string
          identifier_kind?: string
          identifier_value?: string
          migration_version?: string | null
          package_format?: string | null
          readiness_snapshot?: Json | null
          reliability_score?: number | null
          requested_at?: string
          requested_by?: string | null
          rollout_percent?: number | null
          row_count?: number | null
          runner_version?: string | null
          schema_version?: string | null
          signature_algorithm?: string | null
          signature_sha256?: string | null
          signed_manifest?: Json | null
          signer_key_id?: string | null
          signing_key_id?: string | null
          status?: string
          verification_last_at?: string | null
          verification_verdict?: string | null
        }
        Relationships: []
      }
      payment_evidence_retention_checks: {
        Row: {
          checked_at: string
          correlation_id: string | null
          drift_details: Json
          evidence_pack_id: string
          hash_ok: boolean
          id: string
          replay_ok: boolean
          signature_ok: boolean
        }
        Insert: {
          checked_at?: string
          correlation_id?: string | null
          drift_details?: Json
          evidence_pack_id: string
          hash_ok: boolean
          id?: string
          replay_ok: boolean
          signature_ok: boolean
        }
        Update: {
          checked_at?: string
          correlation_id?: string | null
          drift_details?: Json
          evidence_pack_id?: string
          hash_ok?: boolean
          id?: string
          replay_ok?: boolean
          signature_ok?: boolean
        }
        Relationships: []
      }
      payment_forecast_accuracy: {
        Row: {
          absolute_error: number | null
          actual_value: number
          created_at: string
          drift_flag: boolean
          forecast_id: string | null
          id: string
          metric: string
          model_version: string | null
          notes: Json
          percent_error: number | null
          predicted_value: number
          window_end: string
          window_start: string
        }
        Insert: {
          absolute_error?: number | null
          actual_value: number
          created_at?: string
          drift_flag?: boolean
          forecast_id?: string | null
          id?: string
          metric: string
          model_version?: string | null
          notes?: Json
          percent_error?: number | null
          predicted_value: number
          window_end: string
          window_start: string
        }
        Update: {
          absolute_error?: number | null
          actual_value?: number
          created_at?: string
          drift_flag?: boolean
          forecast_id?: string | null
          id?: string
          metric?: string
          model_version?: string | null
          notes?: Json
          percent_error?: number | null
          predicted_value?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      payment_fraud_cases: {
        Row: {
          amount: number | null
          assigned_to: string | null
          case_number: string
          created_at: string
          currency: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id: string
          notes: string | null
          payment_ref: string | null
          payment_source: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["risk_event_severity"]
          signals: Json
          status: Database["public"]["Enums"]["fraud_review_status"]
          updated_at: string
        }
        Insert: {
          amount?: number | null
          assigned_to?: string | null
          case_number?: string
          created_at?: string
          currency?: string | null
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          notes?: string | null
          payment_ref?: string | null
          payment_source?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          signals?: Json
          status?: Database["public"]["Enums"]["fraud_review_status"]
          updated_at?: string
        }
        Update: {
          amount?: number | null
          assigned_to?: string | null
          case_number?: string
          created_at?: string
          currency?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          notes?: string | null
          payment_ref?: string | null
          payment_source?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          signals?: Json
          status?: Database["public"]["Enums"]["fraud_review_status"]
          updated_at?: string
        }
        Relationships: []
      }
      payment_incident_group_members: {
        Row: {
          added_at: string
          alert_id: string
          group_id: string
          id: string
        }
        Insert: {
          added_at?: string
          alert_id: string
          group_id: string
          id?: string
        }
        Update: {
          added_at?: string
          alert_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_incident_group_members_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "payment_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_incident_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "payment_incident_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_incident_groups: {
        Row: {
          created_at: string
          drill_down_context: Json
          first_seen_at: string
          group_key: string
          id: string
          last_seen_at: string
          member_count: number
          root_cause: string
          severity: string
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          drill_down_context?: Json
          first_seen_at?: string
          group_key: string
          id?: string
          last_seen_at?: string
          member_count?: number
          root_cause: string
          severity?: string
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          drill_down_context?: Json
          first_seen_at?: string
          group_key?: string
          id?: string
          last_seen_at?: string
          member_count?: number
          root_cause?: string
          severity?: string
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payment_infra_slo_measurements: {
        Row: {
          breach_severity: string
          id: string
          measured_at: string
          metadata: Json
          observed_value: number
          slo_key: string
          window_seconds: number
        }
        Insert: {
          breach_severity?: string
          id?: string
          measured_at?: string
          metadata?: Json
          observed_value: number
          slo_key: string
          window_seconds?: number
        }
        Update: {
          breach_severity?: string
          id?: string
          measured_at?: string
          metadata?: Json
          observed_value?: number
          slo_key?: string
          window_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_infra_slo_measurements_slo_key_fkey"
            columns: ["slo_key"]
            isOneToOne: false
            referencedRelation: "payment_infra_slos"
            referencedColumns: ["slo_key"]
          },
        ]
      }
      payment_infra_slos: {
        Row: {
          active: boolean
          created_at: string
          critical_value: number
          description: string | null
          direction: string
          display_name: string
          id: string
          slo_key: string
          target_value: number
          unit: string
          updated_at: string
          warn_value: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          critical_value: number
          description?: string | null
          direction?: string
          display_name: string
          id?: string
          slo_key: string
          target_value: number
          unit: string
          updated_at?: string
          warn_value: number
        }
        Update: {
          active?: boolean
          created_at?: string
          critical_value?: number
          description?: string | null
          direction?: string
          display_name?: string
          id?: string
          slo_key?: string
          target_value?: number
          unit?: string
          updated_at?: string
          warn_value?: number
        }
        Relationships: []
      }
      payment_journey_events: {
        Row: {
          actor: string | null
          checkout_request_id: string | null
          correlation_id: string
          event_key: string
          event_status: string
          evidence: Json
          id: string
          latency_ms: number | null
          merchant_request_id: string | null
          occurred_at: string
          order_id: string | null
          parent_correlation_id: string | null
          payment_attempt_id: string | null
          payment_session_id: string | null
          phone: string | null
          ride_id: string | null
          source_component: string | null
          wallet_id: string | null
          workflow_name: string | null
        }
        Insert: {
          actor?: string | null
          checkout_request_id?: string | null
          correlation_id: string
          event_key: string
          event_status?: string
          evidence?: Json
          id?: string
          latency_ms?: number | null
          merchant_request_id?: string | null
          occurred_at?: string
          order_id?: string | null
          parent_correlation_id?: string | null
          payment_attempt_id?: string | null
          payment_session_id?: string | null
          phone?: string | null
          ride_id?: string | null
          source_component?: string | null
          wallet_id?: string | null
          workflow_name?: string | null
        }
        Update: {
          actor?: string | null
          checkout_request_id?: string | null
          correlation_id?: string
          event_key?: string
          event_status?: string
          evidence?: Json
          id?: string
          latency_ms?: number | null
          merchant_request_id?: string | null
          occurred_at?: string
          order_id?: string | null
          parent_correlation_id?: string | null
          payment_attempt_id?: string | null
          payment_session_id?: string | null
          phone?: string | null
          ride_id?: string | null
          source_component?: string | null
          wallet_id?: string | null
          workflow_name?: string | null
        }
        Relationships: []
      }
      payment_journey_stages: {
        Row: {
          correlation_id: string
          evidence: Json
          id: string
          latency_ms: number | null
          occurred_at: string
          payment_attempt_id: string | null
          stage_key: string
          status: string
        }
        Insert: {
          correlation_id: string
          evidence?: Json
          id?: string
          latency_ms?: number | null
          occurred_at?: string
          payment_attempt_id?: string | null
          stage_key: string
          status?: string
        }
        Update: {
          correlation_id?: string
          evidence?: Json
          id?: string
          latency_ms?: number | null
          occurred_at?: string
          payment_attempt_id?: string | null
          stage_key?: string
          status?: string
        }
        Relationships: []
      }
      payment_journey_validations: {
        Row: {
          callback_persisted: boolean | null
          checks: Json
          computed_at: string
          correlation_id: string
          duplicate_events: number
          id: string
          ledger_ok: boolean | null
          missing_stages: string[]
          notification_ok: boolean | null
          orphan_transitions: number
          scenario_id: string | null
          settlement_ok: boolean | null
          status: string
        }
        Insert: {
          callback_persisted?: boolean | null
          checks?: Json
          computed_at?: string
          correlation_id: string
          duplicate_events?: number
          id?: string
          ledger_ok?: boolean | null
          missing_stages?: string[]
          notification_ok?: boolean | null
          orphan_transitions?: number
          scenario_id?: string | null
          settlement_ok?: boolean | null
          status: string
        }
        Update: {
          callback_persisted?: boolean | null
          checks?: Json
          computed_at?: string
          correlation_id?: string
          duplicate_events?: number
          id?: string
          ledger_ok?: boolean | null
          missing_stages?: string[]
          notification_ok?: boolean | null
          orphan_transitions?: number
          scenario_id?: string | null
          settlement_ok?: boolean | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_journey_validations_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "payment_certification_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_load_qualification_runs: {
        Row: {
          callback_latency_p50_ms: number | null
          callback_latency_p95_ms: number | null
          callback_latency_p99_ms: number | null
          concurrency_tier: number
          controller_latency_p95_ms: number | null
          created_at: string
          created_by: string | null
          error_rate: number | null
          failed_requests: number
          financial_integrity_score: number | null
          finished_at: string | null
          id: string
          ledger_latency_p95_ms: number | null
          max_outbox_lag_ms: number | null
          max_queue_depth: number | null
          notes: string | null
          scenario: string
          settlement_latency_p95_ms: number | null
          started_at: string
          status: string
          successful_requests: number
          total_requests: number
          wallet_posting_latency_p95_ms: number | null
        }
        Insert: {
          callback_latency_p50_ms?: number | null
          callback_latency_p95_ms?: number | null
          callback_latency_p99_ms?: number | null
          concurrency_tier: number
          controller_latency_p95_ms?: number | null
          created_at?: string
          created_by?: string | null
          error_rate?: number | null
          failed_requests?: number
          financial_integrity_score?: number | null
          finished_at?: string | null
          id?: string
          ledger_latency_p95_ms?: number | null
          max_outbox_lag_ms?: number | null
          max_queue_depth?: number | null
          notes?: string | null
          scenario?: string
          settlement_latency_p95_ms?: number | null
          started_at?: string
          status?: string
          successful_requests?: number
          total_requests?: number
          wallet_posting_latency_p95_ms?: number | null
        }
        Update: {
          callback_latency_p50_ms?: number | null
          callback_latency_p95_ms?: number | null
          callback_latency_p99_ms?: number | null
          concurrency_tier?: number
          controller_latency_p95_ms?: number | null
          created_at?: string
          created_by?: string | null
          error_rate?: number | null
          failed_requests?: number
          financial_integrity_score?: number | null
          finished_at?: string | null
          id?: string
          ledger_latency_p95_ms?: number | null
          max_outbox_lag_ms?: number | null
          max_queue_depth?: number | null
          notes?: string | null
          scenario?: string
          settlement_latency_p95_ms?: number | null
          started_at?: string
          status?: string
          successful_requests?: number
          total_requests?: number
          wallet_posting_latency_p95_ms?: number | null
        }
        Relationships: []
      }
      payment_manual_overrides: {
        Row: {
          action: string
          created_at: string
          evidence: Json
          expires_at: string | null
          from_percent: number | null
          id: string
          justification: string
          operator_role: string
          operator_user_id: string
          signature: string
          to_percent: number | null
        }
        Insert: {
          action: string
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          from_percent?: number | null
          id?: string
          justification: string
          operator_role: string
          operator_user_id: string
          signature: string
          to_percent?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          from_percent?: number | null
          id?: string
          justification?: string
          operator_role?: string
          operator_user_id?: string
          signature?: string
          to_percent?: number | null
        }
        Relationships: []
      }
      payment_notification_channels: {
        Row: {
          active: boolean
          channel_type: string
          created_at: string
          event_filter: string[]
          id: string
          min_severity: string
          name: string
          secret_ref: string | null
          target: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          channel_type: string
          created_at?: string
          event_filter?: string[]
          id?: string
          min_severity?: string
          name: string
          secret_ref?: string | null
          target: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          channel_type?: string
          created_at?: string
          event_filter?: string[]
          id?: string
          min_severity?: string
          name?: string
          secret_ref?: string | null
          target?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_notification_dispatches: {
        Row: {
          attempt_count: number
          channel_id: string | null
          channel_type: string
          correlation_id: string | null
          created_at: string
          delivery_latency_ms: number | null
          dispatched_at: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          parent_span_id: string | null
          payload: Json
          priority: string
          response_body: string | null
          response_code: number | null
          severity: string
          span_id: string | null
          status: string
          trace_id: string | null
        }
        Insert: {
          attempt_count?: number
          channel_id?: string | null
          channel_type: string
          correlation_id?: string | null
          created_at?: string
          delivery_latency_ms?: number | null
          dispatched_at?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          parent_span_id?: string | null
          payload?: Json
          priority?: string
          response_body?: string | null
          response_code?: number | null
          severity: string
          span_id?: string | null
          status?: string
          trace_id?: string | null
        }
        Update: {
          attempt_count?: number
          channel_id?: string | null
          channel_type?: string
          correlation_id?: string | null
          created_at?: string
          delivery_latency_ms?: number | null
          dispatched_at?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          parent_span_id?: string | null
          payload?: Json
          priority?: string
          response_body?: string | null
          response_code?: number | null
          severity?: string
          span_id?: string | null
          status?: string
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_notification_dispatches_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "payment_notification_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_orchestrator_approvals: {
        Row: {
          approval_expiration: string
          approval_timestamp: string
          approver_role: string | null
          approver_user_id: string | null
          confidence_score: number | null
          consumed_at: string | null
          correlation_id: string
          created_at: string
          from_percent: number
          id: string
          readiness_snapshot: Json
          reason: string | null
          reliability_snapshot: Json
          rollout_stage: number
          signature: string
          status: string
          to_percent: number
        }
        Insert: {
          approval_expiration: string
          approval_timestamp?: string
          approver_role?: string | null
          approver_user_id?: string | null
          confidence_score?: number | null
          consumed_at?: string | null
          correlation_id: string
          created_at?: string
          from_percent: number
          id?: string
          readiness_snapshot?: Json
          reason?: string | null
          reliability_snapshot?: Json
          rollout_stage: number
          signature: string
          status?: string
          to_percent: number
        }
        Update: {
          approval_expiration?: string
          approval_timestamp?: string
          approver_role?: string | null
          approver_user_id?: string | null
          confidence_score?: number | null
          consumed_at?: string | null
          correlation_id?: string
          created_at?: string
          from_percent?: number
          id?: string
          readiness_snapshot?: Json
          reason?: string | null
          reliability_snapshot?: Json
          rollout_stage?: number
          signature?: string
          status?: string
          to_percent?: number
        }
        Relationships: []
      }
      payment_orchestrator_decisions: {
        Row: {
          action: string
          active_critical_incidents: number
          approval_id: string | null
          callback_health: string | null
          confidence_breakdown: Json | null
          confidence_score: number | null
          correlation_id: string | null
          decided_at: string
          environment: string
          evidence: Json
          forecast_evidence: Json | null
          from_percent: number
          gate_ready: boolean | null
          id: string
          is_dry_run: boolean
          reason: string
          reliability_score: number | null
          rollback_simulation: Json | null
          shadow_equivalence: number | null
          to_percent: number
        }
        Insert: {
          action: string
          active_critical_incidents?: number
          approval_id?: string | null
          callback_health?: string | null
          confidence_breakdown?: Json | null
          confidence_score?: number | null
          correlation_id?: string | null
          decided_at?: string
          environment?: string
          evidence?: Json
          forecast_evidence?: Json | null
          from_percent: number
          gate_ready?: boolean | null
          id?: string
          is_dry_run?: boolean
          reason: string
          reliability_score?: number | null
          rollback_simulation?: Json | null
          shadow_equivalence?: number | null
          to_percent: number
        }
        Update: {
          action?: string
          active_critical_incidents?: number
          approval_id?: string | null
          callback_health?: string | null
          confidence_breakdown?: Json | null
          confidence_score?: number | null
          correlation_id?: string | null
          decided_at?: string
          environment?: string
          evidence?: Json
          forecast_evidence?: Json | null
          from_percent?: number
          gate_ready?: boolean | null
          id?: string
          is_dry_run?: boolean
          reason?: string
          reliability_score?: number | null
          rollback_simulation?: Json | null
          shadow_equivalence?: number | null
          to_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_orchestrator_decisions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "payment_orchestrator_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_orchestrator_env_policy: {
        Row: {
          approval_mode: string
          approval_ttl_minutes: number
          approver_roles: string[]
          created_at: string
          emergency_override_role: string
          environment: string
          id: string
          notification_channels: string[]
          required_approver_count: number
          updated_at: string
        }
        Insert: {
          approval_mode?: string
          approval_ttl_minutes?: number
          approver_roles?: string[]
          created_at?: string
          emergency_override_role?: string
          environment: string
          id?: string
          notification_channels?: string[]
          required_approver_count?: number
          updated_at?: string
        }
        Update: {
          approval_mode?: string
          approval_ttl_minutes?: number
          approver_roles?: string[]
          created_at?: string
          emergency_override_role?: string
          environment?: string
          id?: string
          notification_channels?: string[]
          required_approver_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_orchestrator_flag: {
        Row: {
          enabled: boolean
          id: boolean
          kill_switch: boolean
          note: string | null
          rollout_percent: number
          shadow_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          kill_switch?: boolean
          note?: string | null
          rollout_percent?: number
          shadow_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: boolean
          kill_switch?: boolean
          note?: string | null
          rollout_percent?: number
          shadow_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_orchestrator_rollout_stages: {
        Row: {
          active: boolean
          created_at: string
          id: string
          min_dwell_minutes: number
          min_reliability_score: number
          min_shadow_equivalence: number
          stage_order: number
          target_percent: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          min_dwell_minutes?: number
          min_reliability_score?: number
          min_shadow_equivalence?: number
          stage_order: number
          target_percent: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          min_dwell_minutes?: number
          min_reliability_score?: number
          min_shadow_equivalence?: number
          stage_order?: number
          target_percent?: number
        }
        Relationships: []
      }
      payment_orchestrator_shadow_diffs: {
        Row: {
          correlation_id: string
          created_at: string
          deployment_version: string | null
          diff_keys: string[]
          git_revision: string | null
          id: string
          is_equivalent: boolean
          legacy_duration_ms: number | null
          legacy_outcome: Json
          shadow_duration_ms: number | null
          shadow_outcome: Json
        }
        Insert: {
          correlation_id: string
          created_at?: string
          deployment_version?: string | null
          diff_keys?: string[]
          git_revision?: string | null
          id?: string
          is_equivalent: boolean
          legacy_duration_ms?: number | null
          legacy_outcome: Json
          shadow_duration_ms?: number | null
          shadow_outcome: Json
        }
        Update: {
          correlation_id?: string
          created_at?: string
          deployment_version?: string | null
          diff_keys?: string[]
          git_revision?: string | null
          id?: string
          is_equivalent?: boolean
          legacy_duration_ms?: number | null
          legacy_outcome?: Json
          shadow_duration_ms?: number | null
          shadow_outcome?: Json
        }
        Relationships: []
      }
      payment_pci_snapshots: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          per_domain: Json
          score: number
          streak_days: number
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          per_domain?: Json
          score: number
          streak_days?: number
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          per_domain?: Json
          score?: number
          streak_days?: number
        }
        Relationships: []
      }
      payment_pci_streaks: {
        Row: {
          best_days: number
          current_days: number
          id: string
          last_computed_at: string
          last_score: number | null
          started_at: string
          updated_at: string
        }
        Insert: {
          best_days?: number
          current_days?: number
          id?: string
          last_computed_at?: string
          last_score?: number | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          best_days?: number
          current_days?: number
          id?: string
          last_computed_at?: string
          last_score?: number | null
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_platform_health: {
        Row: {
          active_incidents: number
          avg_callback_latency_ms: number | null
          breakdown: Json
          callback_success_rate: number | null
          callbacks_received: number
          computed_at: string
          duplicate_callbacks: number
          edge_invocations: number
          id: string
          idempotency_violations: number
          infra_cert_status: string | null
          journeys_completed: number
          journeys_stalled: number
          oauth_success_rate: number | null
          overall_health_score: number | null
          stk_attempts: number
          stk_success_rate: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          active_incidents?: number
          avg_callback_latency_ms?: number | null
          breakdown?: Json
          callback_success_rate?: number | null
          callbacks_received?: number
          computed_at?: string
          duplicate_callbacks?: number
          edge_invocations?: number
          id?: string
          idempotency_violations?: number
          infra_cert_status?: string | null
          journeys_completed?: number
          journeys_stalled?: number
          oauth_success_rate?: number | null
          overall_health_score?: number | null
          stk_attempts?: number
          stk_success_rate?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          active_incidents?: number
          avg_callback_latency_ms?: number | null
          breakdown?: Json
          callback_success_rate?: number | null
          callbacks_received?: number
          computed_at?: string
          duplicate_callbacks?: number
          edge_invocations?: number
          id?: string
          idempotency_violations?: number
          infra_cert_status?: string | null
          journeys_completed?: number
          journeys_stalled?: number
          oauth_success_rate?: number | null
          overall_health_score?: number | null
          stk_attempts?: number
          stk_success_rate?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      payment_projection_incidents: {
        Row: {
          actual_state: string | null
          expected_state: string
          id: string
          metadata: Json
          opened_at: string
          payment_attempt_id: string
          projection_name: string
          resolution_notes: string | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          actual_state?: string | null
          expected_state: string
          id?: string
          metadata?: Json
          opened_at?: string
          payment_attempt_id: string
          projection_name: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          actual_state?: string | null
          expected_state?: string
          id?: string
          metadata?: Json
          opened_at?: string
          payment_attempt_id?: string
          projection_name?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_projection_incidents_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_projection_registry: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          projection_name: string
          sync_fn: string
          table_name: string
          weight: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          projection_name: string
          sync_fn: string
          table_name: string
          weight?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          projection_name?: string
          sync_fn?: string
          table_name?: string
          weight?: number
        }
        Relationships: []
      }
      payment_projection_sync_runs: {
        Row: {
          after_state: string | null
          attempts: number
          before_state: string | null
          completed_at: string | null
          correlation_id: string | null
          duration_ms: number | null
          id: string
          last_error: string | null
          metadata: Json
          payment_attempt_id: string
          projection_name: string
          started_at: string
          status: string
          trace_id: string | null
        }
        Insert: {
          after_state?: string | null
          attempts?: number
          before_state?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          duration_ms?: number | null
          id?: string
          last_error?: string | null
          metadata?: Json
          payment_attempt_id: string
          projection_name: string
          started_at?: string
          status: string
          trace_id?: string | null
        }
        Update: {
          after_state?: string | null
          attempts?: number
          before_state?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          duration_ms?: number | null
          id?: string
          last_error?: string | null
          metadata?: Json
          payment_attempt_id?: string
          projection_name?: string
          started_at?: string
          status?: string
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_projection_sync_runs_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_projection_sync_runs_projection_name_fkey"
            columns: ["projection_name"]
            isOneToOne: false
            referencedRelation: "payment_projection_registry"
            referencedColumns: ["projection_name"]
          },
        ]
      }
      payment_qualification_evidence_packs: {
        Row: {
          build_version: string | null
          canonical_payload: Json
          canonical_sha256: string
          checkout_request_id: string | null
          correlation_id: string | null
          cq_run_id: string
          created_at: string
          failure_class: string | null
          final_verdict: string
          financial_integrity_score: number | null
          git_revision: string | null
          id: string
          merchant_request_id: string | null
          migration_version: string | null
          readiness_score: number | null
          reliability_score: number | null
          signature: string
          signature_algorithm: string
          signing_key_id: string
          slo_evaluation: Json | null
        }
        Insert: {
          build_version?: string | null
          canonical_payload: Json
          canonical_sha256: string
          checkout_request_id?: string | null
          correlation_id?: string | null
          cq_run_id: string
          created_at?: string
          failure_class?: string | null
          final_verdict: string
          financial_integrity_score?: number | null
          git_revision?: string | null
          id?: string
          merchant_request_id?: string | null
          migration_version?: string | null
          readiness_score?: number | null
          reliability_score?: number | null
          signature: string
          signature_algorithm?: string
          signing_key_id?: string
          slo_evaluation?: Json | null
        }
        Update: {
          build_version?: string | null
          canonical_payload?: Json
          canonical_sha256?: string
          checkout_request_id?: string | null
          correlation_id?: string | null
          cq_run_id?: string
          created_at?: string
          failure_class?: string | null
          final_verdict?: string
          financial_integrity_score?: number | null
          git_revision?: string | null
          id?: string
          merchant_request_id?: string | null
          migration_version?: string | null
          readiness_score?: number | null
          reliability_score?: number | null
          signature?: string
          signature_algorithm?: string
          signing_key_id?: string
          slo_evaluation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_qualification_evidence_packs_cq_run_id_fkey"
            columns: ["cq_run_id"]
            isOneToOne: true
            referencedRelation: "payment_continuous_qualification_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_qualification_evidence_packs_failure_class_fkey"
            columns: ["failure_class"]
            isOneToOne: false
            referencedRelation: "payment_qualification_failure_classes"
            referencedColumns: ["class_key"]
          },
        ]
      }
      payment_qualification_failure_classes: {
        Row: {
          class_key: string
          created_at: string
          description: string | null
          label: string
          severity: string
        }
        Insert: {
          class_key: string
          created_at?: string
          description?: string | null
          label: string
          severity?: string
        }
        Update: {
          class_key?: string
          created_at?: string
          description?: string | null
          label?: string
          severity?: string
        }
        Relationships: []
      }
      payment_qualification_reports: {
        Row: {
          build_version: string | null
          callback_success: Json
          canonical_payload_sha256: string
          certification_summary: Json
          chaos_summary: Json
          critical_incident_count: number
          financial_integrity: Json
          forensics_summary: Json
          generated_at: string
          git_revision: string | null
          hmac_signature: string
          id: string
          latency_percentiles: Json
          load_summary: Json
          migration_version: string | null
          promotion_blockers: Json
          promotion_recommendation: string
          reliability: Json
          report_date: string
          retention_summary: Json
          rolling_windows: Json
          signing_key_id: string
          slo_compliance: Json
        }
        Insert: {
          build_version?: string | null
          callback_success?: Json
          canonical_payload_sha256: string
          certification_summary?: Json
          chaos_summary?: Json
          critical_incident_count?: number
          financial_integrity?: Json
          forensics_summary?: Json
          generated_at?: string
          git_revision?: string | null
          hmac_signature: string
          id?: string
          latency_percentiles?: Json
          load_summary?: Json
          migration_version?: string | null
          promotion_blockers?: Json
          promotion_recommendation: string
          reliability?: Json
          report_date: string
          retention_summary?: Json
          rolling_windows?: Json
          signing_key_id?: string
          slo_compliance?: Json
        }
        Update: {
          build_version?: string | null
          callback_success?: Json
          canonical_payload_sha256?: string
          certification_summary?: Json
          chaos_summary?: Json
          critical_incident_count?: number
          financial_integrity?: Json
          forensics_summary?: Json
          generated_at?: string
          git_revision?: string | null
          hmac_signature?: string
          id?: string
          latency_percentiles?: Json
          load_summary?: Json
          migration_version?: string | null
          promotion_blockers?: Json
          promotion_recommendation?: string
          reliability?: Json
          report_date?: string
          retention_summary?: Json
          rolling_windows?: Json
          signing_key_id?: string
          slo_compliance?: Json
        }
        Relationships: []
      }
      payment_qualification_step_traces: {
        Row: {
          completed_at: string | null
          correlation_id: string | null
          cq_run_id: string
          created_at: string
          error_class: string | null
          error_message: string | null
          evidence_ref: Json | null
          id: string
          latency_ms: number | null
          started_at: string
          status: string
          step_index: number
          step_name: string
        }
        Insert: {
          completed_at?: string | null
          correlation_id?: string | null
          cq_run_id: string
          created_at?: string
          error_class?: string | null
          error_message?: string | null
          evidence_ref?: Json | null
          id?: string
          latency_ms?: number | null
          started_at?: string
          status?: string
          step_index: number
          step_name: string
        }
        Update: {
          completed_at?: string | null
          correlation_id?: string | null
          cq_run_id?: string
          created_at?: string
          error_class?: string | null
          error_message?: string | null
          evidence_ref?: Json | null
          id?: string
          latency_ms?: number | null
          started_at?: string
          status?: string
          step_index?: number
          step_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_qualification_step_traces_cq_run_id_fkey"
            columns: ["cq_run_id"]
            isOneToOne: false
            referencedRelation: "payment_continuous_qualification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_rca_classifications: {
        Row: {
          category: string
          classified_at: string
          classified_by: string
          correlation_id: string
          first_failed_stage: string | null
          id: string
          last_successful_stage: string | null
          payment_attempt_id: string | null
          supporting_evidence: Json
        }
        Insert: {
          category: string
          classified_at?: string
          classified_by?: string
          correlation_id: string
          first_failed_stage?: string | null
          id?: string
          last_successful_stage?: string | null
          payment_attempt_id?: string | null
          supporting_evidence?: Json
        }
        Update: {
          category?: string
          classified_at?: string
          classified_by?: string
          correlation_id?: string
          first_failed_stage?: string | null
          id?: string
          last_successful_stage?: string | null
          payment_attempt_id?: string | null
          supporting_evidence?: Json
        }
        Relationships: []
      }
      payment_receipt_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          note: string | null
          receipt_id: string
          status_after: string | null
          status_before: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          note?: string | null
          receipt_id: string
          status_after?: string | null
          status_before?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          note?: string | null
          receipt_id?: string
          status_after?: string | null
          status_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipt_events_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "payment_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          amount_cents: number
          authorised_name: string | null
          authorised_title: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          is_test: boolean
          lead_id: string | null
          method: string
          notes: string | null
          owner_staff_id: string | null
          payment_reference: string | null
          pdf_sha256: string | null
          receipt_no: string | null
          received_from: string | null
          received_on: string
          sent_at: string | null
          sent_to: string | null
          status: string
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          amount_cents: number
          authorised_name?: string | null
          authorised_title?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          is_test?: boolean
          lead_id?: string | null
          method?: string
          notes?: string | null
          owner_staff_id?: string | null
          payment_reference?: string | null
          pdf_sha256?: string | null
          receipt_no?: string | null
          received_from?: string | null
          received_on?: string
          sent_at?: string | null
          sent_to?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          amount_cents?: number
          authorised_name?: string | null
          authorised_title?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          is_test?: boolean
          lead_id?: string | null
          method?: string
          notes?: string | null
          owner_staff_id?: string | null
          payment_reference?: string | null
          pdf_sha256?: string | null
          receipt_no?: string | null
          received_from?: string | null
          received_on?: string
          sent_at?: string | null
          sent_to?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receiving_accounts: {
        Row: {
          account_number: string
          approved_by: string | null
          channel: string
          config_version: number
          country: string
          created_at: string
          currency: string
          effective_from: string
          effective_until: string | null
          id: string
          note: string | null
          provider: string
          service: string
          status: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          account_number: string
          approved_by?: string | null
          channel: string
          config_version?: number
          country?: string
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          note?: string | null
          provider: string
          service?: string
          status?: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          account_number?: string
          approved_by?: string | null
          channel?: string
          config_version?: number
          country?: string
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          note?: string | null
          provider?: string
          service?: string
          status?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: []
      }
      payment_regression_fingerprints: {
        Row: {
          active: boolean
          ci_workflow: string | null
          description: string
          fingerprint_key: string
          id: string
          registered_at: string
          scenario_key: string | null
          test_path: string | null
          workstream: string
        }
        Insert: {
          active?: boolean
          ci_workflow?: string | null
          description: string
          fingerprint_key: string
          id?: string
          registered_at?: string
          scenario_key?: string | null
          test_path?: string | null
          workstream: string
        }
        Update: {
          active?: boolean
          ci_workflow?: string | null
          description?: string
          fingerprint_key?: string
          id?: string
          registered_at?: string
          scenario_key?: string | null
          test_path?: string | null
          workstream?: string
        }
        Relationships: []
      }
      payment_reliability_forecasts: {
        Row: {
          component: string
          computed_at: string
          current_status: string | null
          eta_minutes: number | null
          evidence: Json
          id: string
          likely_cause: string | null
          predicted_status: string | null
          probability: number | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          component: string
          computed_at?: string
          current_status?: string | null
          eta_minutes?: number | null
          evidence?: Json
          id?: string
          likely_cause?: string | null
          predicted_status?: string | null
          probability?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          component?: string
          computed_at?: string
          current_status?: string | null
          eta_minutes?: number | null
          evidence?: Json
          id?: string
          likely_cause?: string | null
          predicted_status?: string | null
          probability?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      payment_reliability_snapshots: {
        Row: {
          callback_score: number
          certification_score: number
          computed_at: string
          details: Json
          edge_function_score: number
          id: string
          journey_score: number
          reliability_score: number
          slo_score: number
          window_minutes: number
        }
        Insert: {
          callback_score: number
          certification_score: number
          computed_at?: string
          details?: Json
          edge_function_score: number
          id?: string
          journey_score: number
          reliability_score: number
          slo_score: number
          window_minutes?: number
        }
        Update: {
          callback_score?: number
          certification_score?: number
          computed_at?: string
          details?: Json
          edge_function_score?: number
          id?: string
          journey_score?: number
          reliability_score?: number
          slo_score?: number
          window_minutes?: number
        }
        Relationships: []
      }
      payment_replay_cert_divergences: {
        Row: {
          actual: Json | null
          certification_id: string
          correlation_id: string
          detected_at: string
          dimension: string
          expected: Json | null
          id: string
          severity: string
        }
        Insert: {
          actual?: Json | null
          certification_id: string
          correlation_id: string
          detected_at?: string
          dimension: string
          expected?: Json | null
          id?: string
          severity?: string
        }
        Update: {
          actual?: Json | null
          certification_id?: string
          correlation_id?: string
          detected_at?: string
          dimension?: string
          expected?: Json | null
          id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_replay_cert_divergences_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "payment_replay_certifications"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_replay_certifications: {
        Row: {
          created_at: string
          critical: boolean
          diverged: number
          finished_at: string | null
          id: string
          matched: number
          sample_correlation_ids: Json
          sample_size: number
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          created_at?: string
          critical?: boolean
          diverged?: number
          finished_at?: string | null
          id?: string
          matched?: number
          sample_correlation_ids?: Json
          sample_size?: number
          started_at?: string
          status?: string
          summary?: Json
        }
        Update: {
          created_at?: string
          critical?: boolean
          diverged?: number
          finished_at?: string | null
          id?: string
          matched?: number
          sample_correlation_ids?: Json
          sample_size?: number
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: []
      }
      payment_replay_simulations: {
        Row: {
          created_at: string
          divergence: Json | null
          failed_stages: string[]
          finished_at: string | null
          id: string
          original_timeline: Json
          outcome_summary: string | null
          passed_stages: string[]
          requested_by: string | null
          scenario: string
          scenario_params: Json
          simulated_timeline: Json
          source_correlation_id: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          divergence?: Json | null
          failed_stages?: string[]
          finished_at?: string | null
          id?: string
          original_timeline?: Json
          outcome_summary?: string | null
          passed_stages?: string[]
          requested_by?: string | null
          scenario: string
          scenario_params?: Json
          simulated_timeline?: Json
          source_correlation_id: string
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          divergence?: Json | null
          failed_stages?: string[]
          finished_at?: string | null
          id?: string
          original_timeline?: Json
          outcome_summary?: string | null
          passed_stages?: string[]
          requested_by?: string | null
          scenario?: string
          scenario_params?: Json
          simulated_timeline?: Json
          source_correlation_id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      payment_risk_events: {
        Row: {
          created_at: string
          details: Json
          id: string
          resolution: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule: string
          severity: Database["public"]["Enums"]["risk_severity"]
          transaction_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule: string
          severity: Database["public"]["Enums"]["risk_severity"]
          transaction_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule?: string
          severity?: Database["public"]["Enums"]["risk_severity"]
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_risk_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schema_drift_reports: {
        Row: {
          drift_count: number
          extras: Json
          id: string
          manifest_hash: string
          missing_columns: Json
          missing_functions: Json
          missing_tables: Json
          missing_triggers: Json
          passed: boolean | null
          ran_at: string
        }
        Insert: {
          drift_count?: number
          extras?: Json
          id?: string
          manifest_hash: string
          missing_columns?: Json
          missing_functions?: Json
          missing_tables?: Json
          missing_triggers?: Json
          passed?: boolean | null
          ran_at?: string
        }
        Update: {
          drift_count?: number
          extras?: Json
          id?: string
          manifest_hash?: string
          missing_columns?: Json
          missing_functions?: Json
          missing_tables?: Json
          missing_triggers?: Json
          passed?: boolean | null
          ran_at?: string
        }
        Relationships: []
      }
      payment_slo_measurements: {
        Row: {
          actual_value: number
          burn_rate: number | null
          compliant: boolean
          denominator: number
          details: Json
          id: string
          measured_at: string
          numerator: number
          slo_id: string
          target_value: number
          window_end: string
          window_start: string
        }
        Insert: {
          actual_value: number
          burn_rate?: number | null
          compliant: boolean
          denominator: number
          details?: Json
          id?: string
          measured_at?: string
          numerator: number
          slo_id: string
          target_value: number
          window_end: string
          window_start: string
        }
        Update: {
          actual_value?: number
          burn_rate?: number | null
          compliant?: boolean
          denominator?: number
          details?: Json
          id?: string
          measured_at?: string
          numerator?: number
          slo_id?: string
          target_value?: number
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_slo_measurements_slo_id_fkey"
            columns: ["slo_id"]
            isOneToOne: false
            referencedRelation: "payment_slos"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_slos: {
        Row: {
          active: boolean
          category: string
          comparator: string
          config: Json
          created_at: string
          description: string | null
          id: string
          metric_query: string
          name: string
          severity: string
          slo_key: string
          target_value: number
          unit: string
          updated_at: string
          window_minutes: number
        }
        Insert: {
          active?: boolean
          category: string
          comparator?: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          metric_query: string
          name: string
          severity?: string
          slo_key: string
          target_value: number
          unit?: string
          updated_at?: string
          window_minutes?: number
        }
        Update: {
          active?: boolean
          category?: string
          comparator?: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          metric_query?: string
          name?: string
          severity?: string
          slo_key?: string
          target_value?: number
          unit?: string
          updated_at?: string
          window_minutes?: number
        }
        Relationships: []
      }
      payment_stability_windows: {
        Row: {
          callback_success_pct: number
          continuous_qualification_pass_rate: number
          created_at: string
          critical_incidents: number
          evidence_integrity_score: number
          financial_integrity_score: number
          gate_status: string
          id: string
          regressions_count: number
          schema_consistency_score: number
          stability_score: number
          window_end: string
          window_start: string
        }
        Insert: {
          callback_success_pct?: number
          continuous_qualification_pass_rate?: number
          created_at?: string
          critical_incidents?: number
          evidence_integrity_score?: number
          financial_integrity_score?: number
          gate_status?: string
          id?: string
          regressions_count?: number
          schema_consistency_score?: number
          stability_score?: number
          window_end: string
          window_start: string
        }
        Update: {
          callback_success_pct?: number
          continuous_qualification_pass_rate?: number
          created_at?: string
          critical_incidents?: number
          evidence_integrity_score?: number
          financial_integrity_score?: number
          gate_status?: string
          id?: string
          regressions_count?: number
          schema_consistency_score?: number
          stability_score?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      payment_state_transitions: {
        Row: {
          actor: string | null
          correlation_id: string
          evidence: Json
          from_state: string | null
          id: string
          occurred_at: string
          payment_attempt_id: string | null
          reason: string | null
          source_function: string | null
          to_state: string
        }
        Insert: {
          actor?: string | null
          correlation_id: string
          evidence?: Json
          from_state?: string | null
          id?: string
          occurred_at?: string
          payment_attempt_id?: string | null
          reason?: string | null
          source_function?: string | null
          to_state: string
        }
        Update: {
          actor?: string | null
          correlation_id?: string
          evidence?: Json
          from_state?: string | null
          id?: string
          occurred_at?: string
          payment_attempt_id?: string | null
          reason?: string | null
          source_function?: string | null
          to_state?: string
        }
        Relationships: []
      }
      payment_step_traces: {
        Row: {
          correlation_id: string
          error_code: string | null
          error_message: string | null
          evidence: Json
          function_name: string
          id: string
          invocation_id: string | null
          latency_ms: number | null
          occurred_at: string
          payment_attempt_id: string | null
          status: string
          step_key: string
          step_name: string | null
          step_number: number
        }
        Insert: {
          correlation_id: string
          error_code?: string | null
          error_message?: string | null
          evidence?: Json
          function_name: string
          id?: string
          invocation_id?: string | null
          latency_ms?: number | null
          occurred_at?: string
          payment_attempt_id?: string | null
          status: string
          step_key: string
          step_name?: string | null
          step_number: number
        }
        Update: {
          correlation_id?: string
          error_code?: string | null
          error_message?: string | null
          evidence?: Json
          function_name?: string
          id?: string
          invocation_id?: string | null
          latency_ms?: number | null
          occurred_at?: string
          payment_attempt_id?: string | null
          status?: string
          step_key?: string
          step_name?: string | null
          step_number?: number
        }
        Relationships: []
      }
      payout_disbursements: {
        Row: {
          amount: number
          beneficiary_id: string
          beneficiary_type: string
          carrier_id: string | null
          completed_at: string | null
          created_at: string
          currency: string
          destination_id: string | null
          destination_snapshot: Json
          disbursement_reference: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          initiated_by: string | null
          ledger_entry_id: string | null
          msisdn: string
          partner_id: string | null
          payment_evidence: Json | null
          provider: string
          provider_conversation_id: string | null
          provider_originator_conversation_id: string | null
          provider_response_code: string | null
          provider_transaction_id: string | null
          reconciliation_detail: Json | null
          reconciliation_state: string
          result_code: string | null
          result_desc: string | null
          reversal_ledger_entry_id: string | null
          settlement_reference: string | null
          source_id: string
          source_kind: string
          state: string
          updated_at: string
        }
        Insert: {
          amount: number
          beneficiary_id: string
          beneficiary_type: string
          carrier_id?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          destination_id?: string | null
          destination_snapshot?: Json
          disbursement_reference: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          initiated_at?: string | null
          initiated_by?: string | null
          ledger_entry_id?: string | null
          msisdn: string
          partner_id?: string | null
          payment_evidence?: Json | null
          provider?: string
          provider_conversation_id?: string | null
          provider_originator_conversation_id?: string | null
          provider_response_code?: string | null
          provider_transaction_id?: string | null
          reconciliation_detail?: Json | null
          reconciliation_state?: string
          result_code?: string | null
          result_desc?: string | null
          reversal_ledger_entry_id?: string | null
          settlement_reference?: string | null
          source_id: string
          source_kind: string
          state?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          beneficiary_id?: string
          beneficiary_type?: string
          carrier_id?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          destination_id?: string | null
          destination_snapshot?: Json
          disbursement_reference?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          initiated_at?: string | null
          initiated_by?: string | null
          ledger_entry_id?: string | null
          msisdn?: string
          partner_id?: string | null
          payment_evidence?: Json | null
          provider?: string
          provider_conversation_id?: string | null
          provider_originator_conversation_id?: string | null
          provider_response_code?: string | null
          provider_transaction_id?: string | null
          reconciliation_detail?: Json | null
          reconciliation_state?: string
          result_code?: string | null
          result_desc?: string | null
          reversal_ledger_entry_id?: string | null
          settlement_reference?: string | null
          source_id?: string
          source_kind?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_disbursements_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_disbursements_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "carrier_settlement_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_provider_events: {
        Row: {
          amount: number | null
          created_at: string
          disbursement_id: string | null
          event_type: string
          id: string
          payload: Json
          payload_hash: string
          provider: string
          provider_conversation_id: string | null
          provider_transaction_id: string | null
          recipient: string | null
          result_code: string | null
          result_desc: string | null
          transacted_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          disbursement_id?: string | null
          event_type: string
          id?: string
          payload: Json
          payload_hash: string
          provider?: string
          provider_conversation_id?: string | null
          provider_transaction_id?: string | null
          recipient?: string | null
          result_code?: string | null
          result_desc?: string | null
          transacted_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          disbursement_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
          payload_hash?: string
          provider?: string
          provider_conversation_id?: string | null
          provider_transaction_id?: string | null
          recipient?: string | null
          result_code?: string | null
          result_desc?: string | null
          transacted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_provider_events_disbursement_id_fkey"
            columns: ["disbursement_id"]
            isOneToOne: false
            referencedRelation: "payout_disbursements"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_change_log: {
        Row: {
          action: string
          actor_id: string | null
          approval_ref: string | null
          capability_key: string
          created_at: string
          created_by: string | null
          event_hash: string | null
          id: string
          metadata: Json
          new_state: Json | null
          old_state: Json | null
          prev_hash: string | null
          reason: string | null
          region_id: string | null
          risk_score: number
          subject_user_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          approval_ref?: string | null
          capability_key: string
          created_at?: string
          created_by?: string | null
          event_hash?: string | null
          id?: string
          metadata?: Json
          new_state?: Json | null
          old_state?: Json | null
          prev_hash?: string | null
          reason?: string | null
          region_id?: string | null
          risk_score?: number
          subject_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          approval_ref?: string | null
          capability_key?: string
          created_at?: string
          created_by?: string | null
          event_hash?: string | null
          id?: string
          metadata?: Json
          new_state?: Json | null
          old_state?: Json | null
          prev_hash?: string | null
          reason?: string | null
          region_id?: string | null
          risk_score?: number
          subject_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_wallet: {
        Row: {
          created_at: string
          currency: string
          custody_cents: number
          float_cents: number
          funding_msisdn: string
          id: boolean
          income_cents: number
          liability_cents: number
          lifetime_client_cents: number
          lifetime_funded_cents: number
          lifetime_paid_out_cents: number
          lifetime_released_cents: number
          paybill: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          custody_cents?: number
          float_cents?: number
          funding_msisdn?: string
          id?: boolean
          income_cents?: number
          liability_cents?: number
          lifetime_client_cents?: number
          lifetime_funded_cents?: number
          lifetime_paid_out_cents?: number
          lifetime_released_cents?: number
          paybill?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          custody_cents?: number
          float_cents?: number
          funding_msisdn?: string
          id?: boolean
          income_cents?: number
          liability_cents?: number
          lifetime_client_cents?: number
          lifetime_funded_cents?: number
          lifetime_paid_out_cents?: number
          lifetime_released_cents?: number
          paybill?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_wallet_ledger: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          custody_after: number
          custody_delta: number
          detail: Json
          entry_type: string
          float_after: number
          float_delta: number
          id: string
          income_after: number
          income_delta: number
          liability_after: number
          liability_delta: number
          provider_user_id: string | null
          reference: string
          source_id: string | null
          source_kind: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          custody_after: number
          custody_delta?: number
          detail?: Json
          entry_type: string
          float_after: number
          float_delta?: number
          id?: string
          income_after: number
          income_delta?: number
          liability_after: number
          liability_delta?: number
          provider_user_id?: string | null
          reference: string
          source_id?: string | null
          source_kind: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          custody_after?: number
          custody_delta?: number
          detail?: Json
          entry_type?: string
          float_after?: number
          float_delta?: number
          id?: string
          income_after?: number
          income_delta?: number
          liability_after?: number
          liability_delta?: number
          provider_user_id?: string | null
          reference?: string
          source_id?: string | null
          source_kind?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proforma_invoice_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          note: string | null
          proforma_id: string
          status_after: string | null
          status_before: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          note?: string | null
          proforma_id: string
          status_after?: string | null
          status_before?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          note?: string | null
          proforma_id?: string
          status_after?: string | null
          status_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proforma_invoice_events_proforma_id_fkey"
            columns: ["proforma_id"]
            isOneToOne: false
            referencedRelation: "proforma_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      proforma_invoice_lines: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          line_no: number
          proforma_id: string
          qty: number
          service_date: string | null
          unit_rate_cents: number
          vehicle_category: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          line_no: number
          proforma_id: string
          qty?: number
          service_date?: string | null
          unit_rate_cents?: number
          vehicle_category?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          line_no?: number
          proforma_id?: string
          qty?: number
          service_date?: string | null
          unit_rate_cents?: number
          vehicle_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proforma_invoice_lines_proforma_id_fkey"
            columns: ["proforma_id"]
            isOneToOne: false
            referencedRelation: "proforma_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      proforma_invoices: {
        Row: {
          account_id: string | null
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          authorised_name: string | null
          authorised_title: string | null
          booked_by: string | null
          booked_for: string | null
          contract_reference: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_address: string | null
          customer_company: string
          customer_contact_person: string | null
          customer_email: string | null
          customer_phone: string | null
          customer_pin: string | null
          customer_ref: string | null
          id: string
          is_test: boolean
          issue_date: string | null
          issued_at: string | null
          lead_id: string | null
          notes: string | null
          opportunity_id: string | null
          owner_staff_id: string | null
          payment_terms: string
          pdf_sha256: string | null
          proforma_no: string | null
          quote_reference: string | null
          recipient_flag_reason: string | null
          recipient_flagged: boolean
          sent_at: string | null
          sent_to: string | null
          service_from: string | null
          service_to: string | null
          sole_approver: boolean
          status: string
          submitted_at: string | null
          submitted_by: string | null
          subtotal_cents: number
          total_cents: number
          updated_at: string
          valid_until: string | null
          vat_cents: number
          vat_inclusive: boolean
          vat_rate: number
          void_reason: string | null
        }
        Insert: {
          account_id?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorised_name?: string | null
          authorised_title?: string | null
          booked_by?: string | null
          booked_for?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_company?: string
          customer_contact_person?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          customer_pin?: string | null
          customer_ref?: string | null
          id?: string
          is_test?: boolean
          issue_date?: string | null
          issued_at?: string | null
          lead_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          owner_staff_id?: string | null
          payment_terms?: string
          pdf_sha256?: string | null
          proforma_no?: string | null
          quote_reference?: string | null
          recipient_flag_reason?: string | null
          recipient_flagged?: boolean
          sent_at?: string | null
          sent_to?: string | null
          service_from?: string | null
          service_to?: string | null
          sole_approver?: boolean
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
          vat_cents?: number
          vat_inclusive?: boolean
          vat_rate?: number
          void_reason?: string | null
        }
        Update: {
          account_id?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorised_name?: string | null
          authorised_title?: string | null
          booked_by?: string | null
          booked_for?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_company?: string
          customer_contact_person?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          customer_pin?: string | null
          customer_ref?: string | null
          id?: string
          is_test?: boolean
          issue_date?: string | null
          issued_at?: string | null
          lead_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          owner_staff_id?: string | null
          payment_terms?: string
          pdf_sha256?: string | null
          proforma_no?: string | null
          quote_reference?: string | null
          recipient_flag_reason?: string | null
          recipient_flagged?: boolean
          sent_at?: string | null
          sent_to?: string | null
          service_from?: string | null
          service_to?: string | null
          sole_approver?: boolean
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
          vat_cents?: number
          vat_inclusive?: boolean
          vat_rate?: number
          void_reason?: string | null
        }
        Relationships: []
      }
      provider_invoice_lines: {
        Row: {
          booking_reference: string
          commission_cents: number
          created_at: string
          currency: string
          earning_id: string
          gross_cents: number
          id: string
          invoice_id: string
          net_cents: number
          service_date: string | null
        }
        Insert: {
          booking_reference: string
          commission_cents: number
          created_at?: string
          currency?: string
          earning_id: string
          gross_cents: number
          id?: string
          invoice_id: string
          net_cents: number
          service_date?: string | null
        }
        Update: {
          booking_reference?: string
          commission_cents?: number
          created_at?: string
          currency?: string
          earning_id?: string
          gross_cents?: number
          id?: string
          invoice_id?: string
          net_cents?: number
          service_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "provider_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_invoices: {
        Row: {
          commission_bps: number
          commission_cents: number
          created_at: string
          currency: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          estimated_fee_cents: number
          gross_cents: number
          id: string
          invoice_number: string | null
          lines_count: number
          net_cents: number
          period_end: string
          period_start: string
          provider_user_id: string
          state: string
          submitted_at: string | null
          updated_at: string
          withdrawal_fee_bps: number
        }
        Insert: {
          commission_bps?: number
          commission_cents?: number
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          estimated_fee_cents?: number
          gross_cents?: number
          id?: string
          invoice_number?: string | null
          lines_count?: number
          net_cents?: number
          period_end: string
          period_start: string
          provider_user_id: string
          state?: string
          submitted_at?: string | null
          updated_at?: string
          withdrawal_fee_bps?: number
        }
        Update: {
          commission_bps?: number
          commission_cents?: number
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          estimated_fee_cents?: number
          gross_cents?: number
          id?: string
          invoice_number?: string | null
          lines_count?: number
          net_cents?: number
          period_end?: string
          period_start?: string
          provider_user_id?: string
          state?: string
          submitted_at?: string | null
          updated_at?: string
          withdrawal_fee_bps?: number
        }
        Relationships: []
      }
      provider_payout_accounts: {
        Row: {
          account_name: string
          created_at: string
          id: string
          is_default: boolean
          msisdn: string
          provider_user_id: string
          updated_at: string
          verification_note: string | null
          verification_state: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_name: string
          created_at?: string
          id?: string
          is_default?: boolean
          msisdn: string
          provider_user_id: string
          updated_at?: string
          verification_note?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_name?: string
          created_at?: string
          id?: string
          is_default?: boolean
          msisdn?: string
          provider_user_id?: string
          updated_at?: string
          verification_note?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      provider_payout_approval_tiers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          max_cents: number | null
          min_cents: number
          required_approvals: number
          requires_dual_release: boolean
          sla_hours: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          max_cents?: number | null
          min_cents?: number
          required_approvals?: number
          requires_dual_release?: boolean
          sla_hours?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          max_cents?: number | null
          min_cents?: number
          required_approvals?: number
          requires_dual_release?: boolean
          sla_hours?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      provider_payout_approvals: {
        Row: {
          actor_user_id: string
          created_at: string
          decided_at: string
          id: string
          level: number
          note: string | null
          request_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          decided_at?: string
          id?: string
          level: number
          note?: string | null
          request_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          decided_at?: string
          id?: string
          level?: number
          note?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payout_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "provider_payout_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_payout_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          detail: Json
          event_type: string
          id: string
          note: string | null
          request_id: string
          state_from: string | null
          state_to: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          note?: string | null
          request_id: string
          state_from?: string | null
          state_to?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          note?: string | null
          request_id?: string
          state_from?: string | null
          state_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_payout_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "provider_payout_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_payout_requests: {
        Row: {
          account_id: string
          amount_cents: number
          approvals_count: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          currency: string
          decision_note: string | null
          disbursement_id: string | null
          earnings_count: number
          failure_reason: string | null
          fee_bps: number | null
          fee_cents: number | null
          gross_cents: number | null
          hold_reason: string | null
          id: string
          msisdn: string
          paid_at: string | null
          provider_transaction_id: string | null
          provider_user_id: string
          released_at: string | null
          released_by: string | null
          request_reference: string
          required_approvals: number
          requires_dual_release: boolean
          screened_at: string | null
          screening_state: string
          sla_due_at: string | null
          state: string
          submitted_at: string
          tier_id: string | null
          tier_label: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          decision_note?: string | null
          disbursement_id?: string | null
          earnings_count?: number
          failure_reason?: string | null
          fee_bps?: number | null
          fee_cents?: number | null
          gross_cents?: number | null
          hold_reason?: string | null
          id?: string
          msisdn: string
          paid_at?: string | null
          provider_transaction_id?: string | null
          provider_user_id: string
          released_at?: string | null
          released_by?: string | null
          request_reference: string
          required_approvals?: number
          requires_dual_release?: boolean
          screened_at?: string | null
          screening_state?: string
          sla_due_at?: string | null
          state?: string
          submitted_at?: string
          tier_id?: string | null
          tier_label?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          decision_note?: string | null
          disbursement_id?: string | null
          earnings_count?: number
          failure_reason?: string | null
          fee_bps?: number | null
          fee_cents?: number | null
          gross_cents?: number | null
          hold_reason?: string | null
          id?: string
          msisdn?: string
          paid_at?: string | null
          provider_transaction_id?: string | null
          provider_user_id?: string
          released_at?: string | null
          released_by?: string | null
          request_reference?: string
          required_approvals?: number
          requires_dual_release?: boolean
          screened_at?: string | null
          screening_state?: string
          sla_due_at?: string | null
          state?: string
          submitted_at?: string
          tier_id?: string | null
          tier_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payout_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "provider_payout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payout_requests_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "provider_payout_approval_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_payout_screening_results: {
        Row: {
          check_key: string
          created_at: string
          detail: Json
          id: string
          label: string
          request_id: string
          result: string
          run_at: string
        }
        Insert: {
          check_key: string
          created_at?: string
          detail?: Json
          id?: string
          label: string
          request_id: string
          result: string
          run_at?: string
        }
        Update: {
          check_key?: string
          created_at?: string
          detail?: Json
          id?: string
          label?: string
          request_id?: string
          result?: string
          run_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payout_screening_results_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "provider_payout_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_settlement_settings: {
        Row: {
          auto_prepare: boolean
          commission_bps: number
          created_at: string
          currency: string
          id: boolean
          min_payout_cents: number
          payout_shortcode: string | null
          platform_paybill: string
          require_invoice_approval: boolean
          requires_finance_approval: boolean
          updated_at: string
          updated_by: string | null
          withdrawal_fee_bps: number
        }
        Insert: {
          auto_prepare?: boolean
          commission_bps?: number
          created_at?: string
          currency?: string
          id?: boolean
          min_payout_cents?: number
          payout_shortcode?: string | null
          platform_paybill?: string
          require_invoice_approval?: boolean
          requires_finance_approval?: boolean
          updated_at?: string
          updated_by?: string | null
          withdrawal_fee_bps?: number
        }
        Update: {
          auto_prepare?: boolean
          commission_bps?: number
          created_at?: string
          currency?: string
          id?: boolean
          min_payout_cents?: number
          payout_shortcode?: string | null
          platform_paybill?: string
          require_invoice_approval?: boolean
          requires_finance_approval?: boolean
          updated_at?: string
          updated_by?: string | null
          withdrawal_fee_bps?: number
        }
        Relationships: []
      }
      provider_wallet_ledger: {
        Row: {
          amount_cents: number
          available_after: number
          available_delta: number
          created_at: string
          currency: string
          detail: Json
          entry_type: string
          held_after: number
          held_delta: number
          id: string
          provider_user_id: string
          reference: string
          reserved_after: number
          reserved_delta: number
        }
        Insert: {
          amount_cents: number
          available_after: number
          available_delta?: number
          created_at?: string
          currency?: string
          detail?: Json
          entry_type: string
          held_after: number
          held_delta?: number
          id?: string
          provider_user_id: string
          reference: string
          reserved_after: number
          reserved_delta?: number
        }
        Update: {
          amount_cents?: number
          available_after?: number
          available_delta?: number
          created_at?: string
          currency?: string
          detail?: Json
          entry_type?: string
          held_after?: number
          held_delta?: number
          id?: string
          provider_user_id?: string
          reference?: string
          reserved_after?: number
          reserved_delta?: number
        }
        Relationships: []
      }
      provider_wallets: {
        Row: {
          available_cents: number
          created_at: string
          currency: string
          held_cents: number
          lifetime_earned_cents: number
          lifetime_fees_cents: number
          lifetime_withdrawn_cents: number
          provider_user_id: string
          reserved_cents: number
          updated_at: string
        }
        Insert: {
          available_cents?: number
          created_at?: string
          currency?: string
          held_cents?: number
          lifetime_earned_cents?: number
          lifetime_fees_cents?: number
          lifetime_withdrawn_cents?: number
          provider_user_id: string
          reserved_cents?: number
          updated_at?: string
        }
        Update: {
          available_cents?: number
          created_at?: string
          currency?: string
          held_cents?: number
          lifetime_earned_cents?: number
          lifetime_fees_cents?: number
          lifetime_withdrawn_cents?: number
          provider_user_id?: string
          reserved_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      reconciliation_cases: {
        Row: {
          assigned_to: string | null
          case_number: string
          corp_reference: string
          corporate_id: string | null
          created_at: string
          created_by: string | null
          escalation_level: number
          id: string
          metadata: Json
          notes: string | null
          reconciliation_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          reversed: boolean
          reversed_at: string | null
          reversed_by: string | null
          severity: Database["public"]["Enums"]["reconciliation_severity"]
          status: Database["public"]["Enums"]["reconciliation_case_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_number?: string
          corp_reference: string
          corporate_id?: string | null
          created_at?: string
          created_by?: string | null
          escalation_level?: number
          id?: string
          metadata?: Json
          notes?: string | null
          reconciliation_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          reversed?: boolean
          reversed_at?: string | null
          reversed_by?: string | null
          severity?: Database["public"]["Enums"]["reconciliation_severity"]
          status?: Database["public"]["Enums"]["reconciliation_case_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_number?: string
          corp_reference?: string
          corporate_id?: string | null
          created_at?: string
          created_by?: string | null
          escalation_level?: number
          id?: string
          metadata?: Json
          notes?: string | null
          reconciliation_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          reversed?: boolean
          reversed_at?: string | null
          reversed_by?: string | null
          severity?: Database["public"]["Enums"]["reconciliation_severity"]
          status?: Database["public"]["Enums"]["reconciliation_case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_cases_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_cases_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "corporate_financial_reconciliation"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_request_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          from_status: string | null
          id: string
          metadata: Json
          note: string | null
          refund_request_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          refund_request_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          refund_request_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_request_events_refund_request_id_fkey"
            columns: ["refund_request_id"]
            isOneToOne: false
            referencedRelation: "refund_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          amount_cents: number
          approval_note: string | null
          approved_by: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          executed_at: string | null
          execution_ref: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          provider: string
          reason: string
          rejected_reason: string | null
          requested_by: string
          status: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          approval_note?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          dispute_id?: string | null
          executed_at?: string | null
          execution_ref?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          provider?: string
          reason: string
          rejected_reason?: string | null
          requested_by: string
          status?: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          approval_note?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          dispute_id?: string | null
          executed_at?: string | null
          execution_ref?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          provider?: string
          reason?: string
          rejected_reason?: string | null
          requested_by?: string
          status?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "payment_disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_bookings: {
        Row: {
          amount_paid_kes: number
          asset_class: string
          band_label: string
          booking_reference: string
          category: string
          change_reason: string | null
          change_request: string | null
          change_requested_at: string | null
          company_name: string | null
          contact_email: string
          contact_name: string
          contact_phone: string
          correlation_id: string | null
          created_at: string
          currency: string
          end_date: string
          id: string
          mpesa_receipt: string | null
          picked_up_at: string | null
          pickup_location: string
          provider_id: string | null
          quote_id: string
          requested_end_date: string | null
          requested_start_date: string | null
          returned_at: string | null
          rider_user_id: string | null
          start_date: string
          status: string
          total_kes: number
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          amount_paid_kes?: number
          asset_class: string
          band_label: string
          booking_reference: string
          category: string
          change_reason?: string | null
          change_request?: string | null
          change_requested_at?: string | null
          company_name?: string | null
          contact_email: string
          contact_name: string
          contact_phone: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          end_date: string
          id?: string
          mpesa_receipt?: string | null
          picked_up_at?: string | null
          pickup_location: string
          provider_id?: string | null
          quote_id: string
          requested_end_date?: string | null
          requested_start_date?: string | null
          returned_at?: string | null
          rider_user_id?: string | null
          start_date: string
          status?: string
          total_kes: number
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid_kes?: number
          asset_class?: string
          band_label?: string
          booking_reference?: string
          category?: string
          change_reason?: string | null
          change_request?: string | null
          change_requested_at?: string | null
          company_name?: string | null
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          end_date?: string
          id?: string
          mpesa_receipt?: string | null
          picked_up_at?: string | null
          pickup_location?: string
          provider_id?: string | null
          quote_id?: string
          requested_end_date?: string | null
          requested_start_date?: string | null
          returned_at?: string | null
          rider_user_id?: string | null
          start_date?: string
          status?: string
          total_kes?: number
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_bookings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "rental_quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "rental_fleet_units"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_fleet_units: {
        Row: {
          asset_class: string | null
          band_label: string | null
          chauffeur: boolean
          created_at: string
          home_branch: string | null
          id: string
          make: string
          model: string
          notes: string | null
          plate: string
          provenance: string
          provider_id: string | null
          seats: number | null
          self_drive: boolean
          status: string
          transmission: string | null
          updated_at: string
          vehicle_id: string | null
          year: number | null
        }
        Insert: {
          asset_class?: string | null
          band_label?: string | null
          chauffeur?: boolean
          created_at?: string
          home_branch?: string | null
          id?: string
          make: string
          model: string
          notes?: string | null
          plate: string
          provenance?: string
          provider_id?: string | null
          seats?: number | null
          self_drive?: boolean
          status?: string
          transmission?: string | null
          updated_at?: string
          vehicle_id?: string | null
          year?: number | null
        }
        Update: {
          asset_class?: string | null
          band_label?: string | null
          chauffeur?: boolean
          created_at?: string
          home_branch?: string | null
          id?: string
          make?: string
          model?: string
          notes?: string | null
          plate?: string
          provenance?: string
          provider_id?: string | null
          seats?: number | null
          self_drive?: boolean
          status?: string
          transmission?: string | null
          updated_at?: string
          vehicle_id?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_fleet_units_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_ledger_accounts: {
        Row: {
          account: string
          label: string
          normal_side: string
          note: string | null
        }
        Insert: {
          account: string
          label: string
          normal_side: string
          note?: string | null
        }
        Update: {
          account?: string
          label?: string
          normal_side?: string
          note?: string | null
        }
        Relationships: []
      }
      rental_ledger_entries: {
        Row: {
          booking_id: string | null
          correlation_id: string | null
          currency: string
          entry_type: string
          id: string
          memo: string | null
          posted_at: string
          posted_by: string | null
          quote_id: string | null
          source_ref: string
        }
        Insert: {
          booking_id?: string | null
          correlation_id?: string | null
          currency?: string
          entry_type: string
          id?: string
          memo?: string | null
          posted_at?: string
          posted_by?: string | null
          quote_id?: string | null
          source_ref: string
        }
        Update: {
          booking_id?: string | null
          correlation_id?: string | null
          currency?: string
          entry_type?: string
          id?: string
          memo?: string | null
          posted_at?: string
          posted_by?: string | null
          quote_id?: string | null
          source_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_ledger_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "rental_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_ledger_entries_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "rental_quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_ledger_lines: {
        Row: {
          account: string
          amount_kes: number
          detail: Json
          direction: string
          entry_id: string
          id: string
        }
        Insert: {
          account: string
          amount_kes: number
          detail?: Json
          direction: string
          entry_id: string
          id?: string
        }
        Update: {
          account?: string
          amount_kes?: number
          detail?: Json
          direction?: string
          entry_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_ledger_lines_account_fkey"
            columns: ["account"]
            isOneToOne: false
            referencedRelation: "rental_ledger_accounts"
            referencedColumns: ["account"]
          },
          {
            foreignKeyName: "rental_ledger_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "rental_ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_quote_requests: {
        Row: {
          amount_paid_kes: number
          asset_class: string
          band_label: string
          base_kes: number
          category: string
          company_name: string | null
          contact_email: string
          contact_name: string
          contact_phone: string
          correlation_id: string
          created_at: string
          currency: string
          discount_kes: number
          end_date: string
          excess_km_kes: number
          expected_km: number
          expires_at: string
          extra_hours: number
          extra_hours_kes: number
          id: string
          mpesa_receipt: string | null
          notes: string | null
          paid_at: string | null
          payment_status: string
          pickup_location: string
          pricing_snapshot: Json
          pricing_version: number
          reference: string
          rental_days: number
          requested_by: string | null
          seats: number | null
          snapshot_hash: string
          source_page: string | null
          start_date: string
          status: string
          token: string
          total_kes: number
          updated_at: string
          vat_kes: number
        }
        Insert: {
          amount_paid_kes?: number
          asset_class: string
          band_label: string
          base_kes: number
          category: string
          company_name?: string | null
          contact_email: string
          contact_name: string
          contact_phone: string
          correlation_id?: string
          created_at?: string
          currency?: string
          discount_kes?: number
          end_date: string
          excess_km_kes?: number
          expected_km?: number
          expires_at: string
          extra_hours?: number
          extra_hours_kes?: number
          id?: string
          mpesa_receipt?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          pickup_location: string
          pricing_snapshot?: Json
          pricing_version: number
          reference: string
          rental_days: number
          requested_by?: string | null
          seats?: number | null
          snapshot_hash: string
          source_page?: string | null
          start_date: string
          status?: string
          token: string
          total_kes: number
          updated_at?: string
          vat_kes: number
        }
        Update: {
          amount_paid_kes?: number
          asset_class?: string
          band_label?: string
          base_kes?: number
          category?: string
          company_name?: string | null
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          correlation_id?: string
          created_at?: string
          currency?: string
          discount_kes?: number
          end_date?: string
          excess_km_kes?: number
          expected_km?: number
          expires_at?: string
          extra_hours?: number
          extra_hours_kes?: number
          id?: string
          mpesa_receipt?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          pickup_location?: string
          pricing_snapshot?: Json
          pricing_version?: number
          reference?: string
          rental_days?: number
          requested_by?: string | null
          seats?: number | null
          snapshot_hash?: string
          source_page?: string | null
          start_date?: string
          status?: string
          token?: string
          total_kes?: number
          updated_at?: string
          vat_kes?: number
        }
        Relationships: []
      }
      rental_refunds: {
        Row: {
          amount_kes: number | null
          authorised_at: string | null
          authorised_by: string | null
          booking_id: string
          correlation_id: string | null
          created_at: string
          id: string
          notes: string | null
          paid_at: string | null
          paid_reference: string | null
          policy_basis: string | null
          reason: string
          requested_by: string | null
          state: string
          updated_at: string
        }
        Insert: {
          amount_kes?: number | null
          authorised_at?: string | null
          authorised_by?: string | null
          booking_id: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_reference?: string | null
          policy_basis?: string | null
          reason: string
          requested_by?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          amount_kes?: number | null
          authorised_at?: string | null
          authorised_by?: string | null
          booking_id?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_reference?: string | null
          policy_basis?: string | null
          reason?: string
          requested_by?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_refunds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "rental_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_events: {
        Row: {
          corporate_id: string | null
          created_at: string
          currency: string
          driver_id: string | null
          event_type: Database["public"]["Enums"]["revenue_event_type"]
          gross_amount_cents: number
          id: string
          journal_id: string | null
          metadata: Json
          occurred_at: string
          recognized_at: string | null
          rider_id: string | null
          source_ref: string | null
          status: string
        }
        Insert: {
          corporate_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          event_type: Database["public"]["Enums"]["revenue_event_type"]
          gross_amount_cents: number
          id?: string
          journal_id?: string | null
          metadata?: Json
          occurred_at?: string
          recognized_at?: string | null
          rider_id?: string | null
          source_ref?: string | null
          status?: string
        }
        Update: {
          corporate_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          event_type?: Database["public"]["Enums"]["revenue_event_type"]
          gross_amount_cents?: number
          id?: string
          journal_id?: string | null
          metadata?: Json
          occurred_at?: string
          recognized_at?: string | null
          rider_id?: string | null
          source_ref?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_events_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_payment_intents: {
        Row: {
          amount_cents: number
          approval_id: string | null
          booking_id: string | null
          cancelled_at: string | null
          channel_id: string | null
          corporate_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          currency: string
          decision: string | null
          decision_reasons: string[]
          failure_reason: string | null
          id: string
          invoice_id: string | null
          mode: string
          mpesa_receipt: string | null
          paid_amount_cents: number
          receivable_id: string | null
          reference: string
          reservation_id: string | null
          state: Database["public"]["Enums"]["ride_payment_state"]
          trip_request_id: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount_cents: number
          approval_id?: string | null
          booking_id?: string | null
          cancelled_at?: string | null
          channel_id?: string | null
          corporate_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          decision?: string | null
          decision_reasons?: string[]
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          mode: string
          mpesa_receipt?: string | null
          paid_amount_cents?: number
          receivable_id?: string | null
          reference: string
          reservation_id?: string | null
          state?: Database["public"]["Enums"]["ride_payment_state"]
          trip_request_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount_cents?: number
          approval_id?: string | null
          booking_id?: string | null
          cancelled_at?: string | null
          channel_id?: string | null
          corporate_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          decision?: string | null
          decision_reasons?: string[]
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          mode?: string
          mpesa_receipt?: string | null
          paid_amount_cents?: number
          receivable_id?: string | null
          reference?: string
          reservation_id?: string | null
          state?: Database["public"]["Enums"]["ride_payment_state"]
          trip_request_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_payment_intents_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "yalla_payment_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_payment_intents_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_payment_intents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "corporate_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_payment_intents_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "corporate_credit_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_types: {
        Row: {
          base_fare: number
          cancellation_fee: number
          capacity: number
          code: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          minimum_fare: number
          name: string
          per_km_rate: number
          per_minute_rate: number
          sort_order: number | null
        }
        Insert: {
          base_fare?: number
          cancellation_fee?: number
          capacity?: number
          code: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          minimum_fare?: number
          name: string
          per_km_rate?: number
          per_minute_rate?: number
          sort_order?: number | null
        }
        Update: {
          base_fare?: number
          cancellation_fee?: number
          capacity?: number
          code?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          minimum_fare?: number
          name?: string
          per_km_rate?: number
          per_minute_rate?: number
          sort_order?: number | null
        }
        Relationships: []
      }
      rider_devices: {
        Row: {
          created_at: string
          device_name: string | null
          device_token: string
          id: string
          is_active: boolean | null
          last_seen_at: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          device_token: string
          id?: string
          is_active?: boolean | null
          last_seen_at?: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          device_token?: string
          id?: string
          is_active?: boolean | null
          last_seen_at?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      rider_kyc: {
        Row: {
          country: string
          created_at: string
          document_url: string | null
          id: string
          id_number: string
          id_type: string
          rejection_reason: string | null
          rider_user_id: string
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          document_url?: string | null
          id?: string
          id_number: string
          id_type: string
          rejection_reason?: string | null
          rider_user_id: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          document_url?: string | null
          id?: string
          id_number?: string
          id_type?: string
          rejection_reason?: string | null
          rider_user_id?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      rider_notifications: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          id: string
          read_at: string | null
          title: string
          trip_booking_id: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          trip_booking_id?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          trip_booking_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_notifications_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_payment_methods: {
        Row: {
          created_at: string
          display_label: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          masked_identifier: string | null
          metadata: Json | null
          method_type: string
          provider: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_label: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          masked_identifier?: string | null
          metadata?: Json | null
          method_type: string
          provider?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_label?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          masked_identifier?: string | null
          metadata?: Json | null
          method_type?: string
          provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rider_profiles: {
        Row: {
          accessibility_needs: string[] | null
          country_code: string | null
          created_at: string
          date_of_birth: string | null
          display_name: string | null
          email: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          lifetime_spend: number
          lifetime_trips: number
          middle_name: string | null
          phone_number: string | null
          photo_url: string | null
          preferred_language: string | null
          rating_avg: number
          rating_count: number
          rider_tier: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accessibility_needs?: string[] | null
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          lifetime_spend?: number
          lifetime_trips?: number
          middle_name?: string | null
          phone_number?: string | null
          photo_url?: string | null
          preferred_language?: string | null
          rating_avg?: number
          rating_count?: number
          rider_tier?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accessibility_needs?: string[] | null
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          lifetime_spend?: number
          lifetime_trips?: number
          middle_name?: string | null
          phone_number?: string | null
          photo_url?: string | null
          preferred_language?: string | null
          rating_avg?: number
          rating_count?: number
          rider_tier?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rider_promotions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          max_discount: number | null
          min_fare: number | null
          usage_limit: number | null
          used_count: number
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value: number
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_fare?: number | null
          usage_limit?: number | null
          used_count?: number
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_fare?: number | null
          usage_limit?: number | null
          used_count?: number
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      rider_reward_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          points: number
          reason: string | null
          trip_booking_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          points: number
          reason?: string | null
          trip_booking_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          points?: number
          reason?: string | null
          trip_booking_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_reward_events_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_rewards: {
        Row: {
          id: string
          lifetime_points: number
          points_balance: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          lifetime_points?: number
          points_balance?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          lifetime_points?: number
          points_balance?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rider_wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          reference: string | null
          status: string
          trip_booking_id: string | null
          txn_type: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          reference?: string | null
          status?: string
          trip_booking_id?: string | null
          txn_type: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          reference?: string | null
          status?: string
          trip_booking_id?: string | null
          txn_type?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_wallet_transactions_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "rider_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          region_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          region_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          region_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_log: {
        Row: {
          action: string
          actor_id: string | null
          approval_ref: string | null
          created_at: string
          created_by: string | null
          event_hash: string | null
          id: string
          metadata: Json
          new_role: Database["public"]["Enums"]["app_role"] | null
          old_role: Database["public"]["Enums"]["app_role"] | null
          prev_hash: string | null
          reason: string | null
          region_id: string | null
          risk_score: number
          subject_user_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          approval_ref?: string | null
          created_at?: string
          created_by?: string | null
          event_hash?: string | null
          id?: string
          metadata?: Json
          new_role?: Database["public"]["Enums"]["app_role"] | null
          old_role?: Database["public"]["Enums"]["app_role"] | null
          prev_hash?: string | null
          reason?: string | null
          region_id?: string | null
          risk_score?: number
          subject_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          approval_ref?: string | null
          created_at?: string
          created_by?: string | null
          event_hash?: string | null
          id?: string
          metadata?: Json
          new_role?: Database["public"]["Enums"]["app_role"] | null
          old_role?: Database["public"]["Enums"]["app_role"] | null
          prev_hash?: string | null
          reason?: string | null
          region_id?: string | null
          risk_score?: number
          subject_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_grant_drift_checks: {
        Row: {
          checked_at: string
          gap_count: number
          gaps: Json
          id: string
          notification_channel: string | null
          notification_error: string | null
          notified_at: string | null
          repaired: boolean
          source: string
        }
        Insert: {
          checked_at?: string
          gap_count?: number
          gaps?: Json
          id?: string
          notification_channel?: string | null
          notification_error?: string | null
          notified_at?: string | null
          repaired?: boolean
          source?: string
        }
        Update: {
          checked_at?: string
          gap_count?: number
          gaps?: Json
          id?: string
          notification_channel?: string | null
          notification_error?: string | null
          notified_at?: string | null
          repaired?: boolean
          source?: string
        }
        Relationships: []
      }
      role_grant_guard_events: {
        Row: {
          actor: string
          applied_grantees: string[]
          command_tag: string | null
          details: Json
          event_type: string
          function_owner: string | null
          function_signature: string | null
          id: string
          missing_grantees: string[]
          occurred_at: string
          security_definer: boolean | null
        }
        Insert: {
          actor?: string
          applied_grantees?: string[]
          command_tag?: string | null
          details?: Json
          event_type: string
          function_owner?: string | null
          function_signature?: string | null
          id?: string
          missing_grantees?: string[]
          occurred_at?: string
          security_definer?: boolean | null
        }
        Update: {
          actor?: string
          applied_grantees?: string[]
          command_tag?: string | null
          details?: Json
          event_type?: string
          function_owner?: string | null
          function_signature?: string | null
          id?: string
          missing_grantees?: string[]
          occurred_at?: string
          security_definer?: boolean | null
        }
        Relationships: []
      }
      safety_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          message: string | null
          status: string
          trip_booking_id: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          message?: string | null
          status?: string
          trip_booking_id?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          message?: string | null
          status?: string
          trip_booking_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_alerts_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_leads: {
        Row: {
          account_id: string | null
          awaiting_due_date: string | null
          awaiting_item: string | null
          booking_ref: string | null
          closed_at: string | null
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          contact_state: string
          contact_token: string | null
          contract_shared_at: string | null
          contract_signed_at: string | null
          created_at: string
          created_by: string
          currency: string
          destination_label: string | null
          estimated_value_kes: number | null
          first_outreach_at: string | null
          first_reply_at: string | null
          id: string
          import_batch_id: string | null
          information_request: string | null
          is_test: boolean
          last_outreach_at: string | null
          last_reply_at: string | null
          lead_ref: string
          lost_competitor: string | null
          lost_expected_price_kes: number | null
          lost_reason: string | null
          lost_reason_code: string | null
          lost_revisit_date: string | null
          meeting_held_at: string | null
          notes: string | null
          opportunity_id: string | null
          order_id: string | null
          organisation_name: string
          origin_label: string | null
          partner_application_id: string | null
          proposal_sent_at: string | null
          qualification_notes: string | null
          qualified_at: string | null
          quote_shared_at: string | null
          sales_staff_id: string
          service_date: string | null
          service_interest: string
          source: string
          stage: string
          submitted_by_user_id: string | null
          updated_at: string
          waiting_on: string | null
          won_revenue_kes: number | null
        }
        Insert: {
          account_id?: string | null
          awaiting_due_date?: string | null
          awaiting_item?: string | null
          booking_ref?: string | null
          closed_at?: string | null
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          contact_state?: string
          contact_token?: string | null
          contract_shared_at?: string | null
          contract_signed_at?: string | null
          created_at?: string
          created_by: string
          currency?: string
          destination_label?: string | null
          estimated_value_kes?: number | null
          first_outreach_at?: string | null
          first_reply_at?: string | null
          id?: string
          import_batch_id?: string | null
          information_request?: string | null
          is_test?: boolean
          last_outreach_at?: string | null
          last_reply_at?: string | null
          lead_ref: string
          lost_competitor?: string | null
          lost_expected_price_kes?: number | null
          lost_reason?: string | null
          lost_reason_code?: string | null
          lost_revisit_date?: string | null
          meeting_held_at?: string | null
          notes?: string | null
          opportunity_id?: string | null
          order_id?: string | null
          organisation_name: string
          origin_label?: string | null
          partner_application_id?: string | null
          proposal_sent_at?: string | null
          qualification_notes?: string | null
          qualified_at?: string | null
          quote_shared_at?: string | null
          sales_staff_id: string
          service_date?: string | null
          service_interest: string
          source?: string
          stage?: string
          submitted_by_user_id?: string | null
          updated_at?: string
          waiting_on?: string | null
          won_revenue_kes?: number | null
        }
        Update: {
          account_id?: string | null
          awaiting_due_date?: string | null
          awaiting_item?: string | null
          booking_ref?: string | null
          closed_at?: string | null
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          contact_state?: string
          contact_token?: string | null
          contract_shared_at?: string | null
          contract_signed_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          destination_label?: string | null
          estimated_value_kes?: number | null
          first_outreach_at?: string | null
          first_reply_at?: string | null
          id?: string
          import_batch_id?: string | null
          information_request?: string | null
          is_test?: boolean
          last_outreach_at?: string | null
          last_reply_at?: string | null
          lead_ref?: string
          lost_competitor?: string | null
          lost_expected_price_kes?: number | null
          lost_reason?: string | null
          lost_reason_code?: string | null
          lost_revisit_date?: string | null
          meeting_held_at?: string | null
          notes?: string | null
          opportunity_id?: string | null
          order_id?: string | null
          organisation_name?: string
          origin_label?: string | null
          partner_application_id?: string | null
          proposal_sent_at?: string | null
          qualification_notes?: string | null
          qualified_at?: string | null
          quote_shared_at?: string | null
          sales_staff_id?: string
          service_date?: string | null
          service_interest?: string
          source?: string
          stage?: string
          submitted_by_user_id?: string | null
          updated_at?: string
          waiting_on?: string | null
          won_revenue_kes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_leads_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "commercial_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_leads_sales_staff_id_fkey"
            columns: ["sales_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_trips: {
        Row: {
          created_at: string
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          next_booking_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          recurrence: string | null
          recurrence_until: string | null
          ride_type_id: string | null
          scheduled_for: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id?: string
          next_booking_id?: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          recurrence?: string | null
          recurrence_until?: string | null
          ride_type_id?: string | null
          scheduled_for: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dropoff_address?: string
          dropoff_lat?: number
          dropoff_lng?: number
          id?: string
          next_booking_id?: string | null
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          recurrence?: string | null
          recurrence_until?: string | null
          ride_type_id?: string | null
          scheduled_for?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_trips_ride_type_id_fkey"
            columns: ["ride_type_id"]
            isOneToOne: false
            referencedRelation: "ride_types"
            referencedColumns: ["id"]
          },
        ]
      }
      service_provider_claims: {
        Row: {
          agreed_amount_kes: number | null
          approved_amount_kes: number | null
          carrier_id: string
          claim_ref: string
          claimed_amount_kes: number
          created_at: string
          currency: string
          customer_label: string | null
          declaration_accepted_at: string | null
          declaration_name: string | null
          destination_id: string | null
          destination_label: string | null
          id: string
          leg_id: string
          order_id: string | null
          origin_label: string | null
          payable_line_id: string | null
          pod_submission_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sales_lead_id: string | null
          sales_staff_id: string | null
          service_date: string | null
          service_description: string
          state: string
          submitted_at: string | null
          submitted_by: string | null
          supporting_documents: Json
          updated_at: string
        }
        Insert: {
          agreed_amount_kes?: number | null
          approved_amount_kes?: number | null
          carrier_id: string
          claim_ref: string
          claimed_amount_kes: number
          created_at?: string
          currency?: string
          customer_label?: string | null
          declaration_accepted_at?: string | null
          declaration_name?: string | null
          destination_id?: string | null
          destination_label?: string | null
          id?: string
          leg_id: string
          order_id?: string | null
          origin_label?: string | null
          payable_line_id?: string | null
          pod_submission_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sales_lead_id?: string | null
          sales_staff_id?: string | null
          service_date?: string | null
          service_description: string
          state?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supporting_documents?: Json
          updated_at?: string
        }
        Update: {
          agreed_amount_kes?: number | null
          approved_amount_kes?: number | null
          carrier_id?: string
          claim_ref?: string
          claimed_amount_kes?: number
          created_at?: string
          currency?: string
          customer_label?: string | null
          declaration_accepted_at?: string | null
          declaration_name?: string | null
          destination_id?: string | null
          destination_label?: string | null
          id?: string
          leg_id?: string
          order_id?: string | null
          origin_label?: string | null
          payable_line_id?: string | null
          pod_submission_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sales_lead_id?: string | null
          sales_staff_id?: string | null
          service_date?: string | null
          service_description?: string
          state?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supporting_documents?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_provider_claims_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_claims_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "carrier_settlement_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_claims_payable_line_id_fkey"
            columns: ["payable_line_id"]
            isOneToOne: false
            referencedRelation: "carrier_payable_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_claims_pod_submission_id_fkey"
            columns: ["pod_submission_id"]
            isOneToOne: false
            referencedRelation: "carrier_pod_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_claims_sales_lead_id_fkey"
            columns: ["sales_lead_id"]
            isOneToOne: false
            referencedRelation: "sales_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_claims_sales_staff_id_fkey"
            columns: ["sales_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      service_provider_invoices: {
        Row: {
          amount_kes: number
          carrier_id: string
          claim_id: string
          created_at: string
          currency: string
          id: string
          invoice_ref: string
          issued_at: string
          issued_by: string | null
          leg_id: string | null
          order_id: string | null
          payable_line_id: string | null
          pod_submission_id: string
          sales_staff_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          amount_kes: number
          carrier_id: string
          claim_id: string
          created_at?: string
          currency?: string
          id?: string
          invoice_ref: string
          issued_at?: string
          issued_by?: string | null
          leg_id?: string | null
          order_id?: string | null
          payable_line_id?: string | null
          pod_submission_id: string
          sales_staff_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          amount_kes?: number
          carrier_id?: string
          claim_id?: string
          created_at?: string
          currency?: string
          id?: string
          invoice_ref?: string
          issued_at?: string
          issued_by?: string | null
          leg_id?: string | null
          order_id?: string | null
          payable_line_id?: string | null
          pod_submission_id?: string
          sales_staff_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_provider_invoices_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_invoices_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "service_provider_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_invoices_sales_staff_id_fkey"
            columns: ["sales_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      service_provider_payment_receipts: {
        Row: {
          document_version: number
          id: string
          integrity_hash: string
          issued_at: string
          issued_by: string | null
          payment_id: string
          receipt_no: string
          verification_token: string
        }
        Insert: {
          document_version?: number
          id?: string
          integrity_hash: string
          issued_at?: string
          issued_by?: string | null
          payment_id: string
          receipt_no: string
          verification_token: string
        }
        Update: {
          document_version?: number
          id?: string
          integrity_hash?: string
          issued_at?: string
          issued_by?: string | null
          payment_id?: string
          receipt_no?: string
          verification_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_provider_payment_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "service_provider_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      service_provider_payments: {
        Row: {
          amount_kes: number
          authorised_at: string
          authorised_by: string | null
          carrier_id: string
          claim_id: string
          created_at: string
          currency: string
          destination_id: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          invoice_id: string
          method: string
          msisdn_snapshot: string
          paid_at: string | null
          payment_ref: string
          provider_payload: Json | null
          provider_reference: string | null
          recorded_by: string | null
          state: string
          updated_at: string
        }
        Insert: {
          amount_kes: number
          authorised_at?: string
          authorised_by?: string | null
          carrier_id: string
          claim_id: string
          created_at?: string
          currency?: string
          destination_id: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          invoice_id: string
          method?: string
          msisdn_snapshot: string
          paid_at?: string | null
          payment_ref: string
          provider_payload?: Json | null
          provider_reference?: string | null
          recorded_by?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          amount_kes?: number
          authorised_at?: string
          authorised_by?: string | null
          carrier_id?: string
          claim_id?: string
          created_at?: string
          currency?: string
          destination_id?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string
          method?: string
          msisdn_snapshot?: string
          paid_at?: string | null
          payment_ref?: string
          provider_payload?: Json | null
          provider_reference?: string | null
          recorded_by?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_provider_payments_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carrier_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_payments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "service_provider_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_payments_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "carrier_settlement_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_provider_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "service_provider_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_batches: {
        Row: {
          batch_ref: string
          closed_at: string | null
          created_at: string
          currency: string
          cutoff_at: string
          id: string
          provider: string
          status: Database["public"]["Enums"]["settlement_batch_status"]
          total_amount_cents: number
          total_count: number
          treasury_account_id: string | null
        }
        Insert: {
          batch_ref: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          cutoff_at: string
          id?: string
          provider: string
          status?: Database["public"]["Enums"]["settlement_batch_status"]
          total_amount_cents?: number
          total_count?: number
          treasury_account_id?: string | null
        }
        Update: {
          batch_ref?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          cutoff_at?: string
          id?: string
          provider?: string
          status?: Database["public"]["Enums"]["settlement_batch_status"]
          total_amount_cents?: number
          total_count?: number
          treasury_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_batches_treasury_account_id_fkey"
            columns: ["treasury_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_failures: {
        Row: {
          batch_id: string | null
          created_at: string
          error_code: string | null
          error_message: string
          id: string
          resolved_at: string | null
          retry_count: number
          settlement_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message: string
          id?: string
          resolved_at?: string | null
          retry_count?: number
          settlement_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string
          id?: string
          resolved_at?: string | null
          retry_count?: number
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_failures_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "settlement_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_failures_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_obligations: {
        Row: {
          calculation: Json
          created_at: string
          currency: string
          driver_id: string | null
          entitlement_cents: number
          id: string
          paid_at: string | null
          paid_cents: number | null
          payable_at: string | null
          payout_id: string | null
          provider_kind: string
          provider_ref: string | null
          reconciled_at: string | null
          status: string
          transaction_id: string
          updated_at: string
          variance_cents: number | null
          variance_reason: string | null
        }
        Insert: {
          calculation?: Json
          created_at?: string
          currency?: string
          driver_id?: string | null
          entitlement_cents: number
          id?: string
          paid_at?: string | null
          paid_cents?: number | null
          payable_at?: string | null
          payout_id?: string | null
          provider_kind?: string
          provider_ref?: string | null
          reconciled_at?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Update: {
          calculation?: Json
          created_at?: string
          currency?: string
          driver_id?: string | null
          entitlement_cents?: number
          id?: string
          paid_at?: string | null
          paid_cents?: number | null
          payable_at?: string | null
          payout_id?: string | null
          provider_kind?: string
          provider_ref?: string | null
          reconciled_at?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_obligations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "commercial_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_reconciliation: {
        Row: {
          actual_amount_cents: number
          actual_count: number
          batch_id: string
          details: Json
          expected_amount_cents: number
          expected_count: number
          id: string
          ran_at: string
          status: string
          variance_cents: number
        }
        Insert: {
          actual_amount_cents: number
          actual_count: number
          batch_id: string
          details?: Json
          expected_amount_cents: number
          expected_count: number
          id?: string
          ran_at?: string
          status: string
          variance_cents: number
        }
        Update: {
          actual_amount_cents?: number
          actual_count?: number
          batch_id?: string
          details?: Json
          expected_amount_cents?: number
          expected_count?: number
          id?: string
          ran_at?: string
          status?: string
          variance_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "settlement_reconciliation_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "settlement_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_cents: number
          batch_id: string
          created_at: string
          currency: string
          id: string
          notes: string | null
          provider_ref: string | null
          status: Database["public"]["Enums"]["settlement_status"]
          transaction_id: string | null
          variance_cents: number
        }
        Insert: {
          amount_cents: number
          batch_id: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          provider_ref?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          transaction_id?: string | null
          variance_cents?: number
        }
        Update: {
          amount_cents?: number
          batch_id?: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          provider_ref?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          transaction_id?: string | null
          variance_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "settlements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "settlement_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_action_outcomes: {
        Row: {
          actual_value: number | null
          adaptation: string | null
          agent_key: string
          decision_id: string | null
          expected_value: number | null
          id: string
          lesson: string | null
          measure_key: string
          recorded_at: string
          recorded_by: string | null
          succeeded: boolean | null
          unit: string
        }
        Insert: {
          actual_value?: number | null
          adaptation?: string | null
          agent_key: string
          decision_id?: string | null
          expected_value?: number | null
          id?: string
          lesson?: string | null
          measure_key: string
          recorded_at?: string
          recorded_by?: string | null
          succeeded?: boolean | null
          unit?: string
        }
        Update: {
          actual_value?: number | null
          adaptation?: string | null
          agent_key?: string
          decision_id?: string | null
          expected_value?: number | null
          id?: string
          lesson?: string | null
          measure_key?: string
          recorded_at?: string
          recorded_by?: string | null
          succeeded?: boolean | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_action_outcomes_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "staff_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attention_signals: {
        Row: {
          batch_label: string
          confidence: number
          created_at: string
          domain: string
          evidence: string[]
          expected_impact: string
          id: string
          owner: string
          recommended_action: string
          severity: string
          source: string
          state: string
          title: string
          updated_at: string
          why: string
        }
        Insert: {
          batch_label?: string
          confidence: number
          created_at?: string
          domain: string
          evidence?: string[]
          expected_impact: string
          id?: string
          owner: string
          recommended_action: string
          severity?: string
          source: string
          state?: string
          title: string
          updated_at?: string
          why: string
        }
        Update: {
          batch_label?: string
          confidence?: number
          created_at?: string
          domain?: string
          evidence?: string[]
          expected_impact?: string
          id?: string
          owner?: string
          recommended_action?: string
          severity?: string
          source?: string
          state?: string
          title?: string
          updated_at?: string
          why?: string
        }
        Relationships: []
      }
      staff_baseline_permissions: {
        Row: {
          active: boolean
          approved_by: string | null
          created_at: string
          permission_key: string
          reason: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approved_by?: string | null
          created_at?: string
          permission_key: string
          reason: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approved_by?: string | null
          created_at?: string
          permission_key?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_baseline_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: true
            referencedRelation: "staff_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      staff_calendar_blocks: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          kind: string
          staff_id: string
          starts_at: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          kind?: string
          staff_id: string
          starts_at: string
          title?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          kind?: string
          staff_id?: string
          starts_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_calendar_blocks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_calendar_connections: {
        Row: {
          account_email: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          provider: string
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_email?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          provider: string
          staff_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_email?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          provider?: string
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_calendar_connections_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_competencies: {
        Row: {
          assessed_at: string
          assessed_by: string | null
          assessed_level: number
          competency_id: string
          created_at: string
          evidence: string | null
          id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          assessed_at?: string
          assessed_by?: string | null
          assessed_level: number
          competency_id: string
          created_at?: string
          evidence?: string | null
          id?: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          assessed_at?: string
          assessed_by?: string | null
          assessed_level?: number
          competency_id?: string
          created_at?: string
          evidence?: string | null
          id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_competencies_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "org_competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_competencies_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_corrective_actions: {
        Row: {
          cause_category: string
          cause_description: string
          corrective_action: string | null
          created_at: string
          due_date: string | null
          evidence_note: string | null
          evidence_source_id: string | null
          evidence_source_table: string | null
          id: string
          impact_days: number | null
          impact_value_cents: number | null
          objective_id: string | null
          owner_staff_id: string | null
          reported_by: string | null
          resolution: string | null
          resolved_at: string | null
          staff_id: string | null
          status: string
          trigger_kind: string
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          cause_category: string
          cause_description: string
          corrective_action?: string | null
          created_at?: string
          due_date?: string | null
          evidence_note?: string | null
          evidence_source_id?: string | null
          evidence_source_table?: string | null
          id?: string
          impact_days?: number | null
          impact_value_cents?: number | null
          objective_id?: string | null
          owner_staff_id?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          staff_id?: string | null
          status?: string
          trigger_kind: string
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          cause_category?: string
          cause_description?: string
          corrective_action?: string | null
          created_at?: string
          due_date?: string | null
          evidence_note?: string | null
          evidence_source_id?: string | null
          evidence_source_table?: string | null
          id?: string
          impact_days?: number | null
          impact_value_cents?: number | null
          objective_id?: string | null
          owner_staff_id?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          staff_id?: string | null
          status?: string
          trigger_kind?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_corrective_actions_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "org_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_corrective_actions_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_corrective_actions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_corrective_actions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "staff_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_decision_audit: {
        Row: {
          actor: string | null
          actor_roles: string[]
          created_at: string
          decision_id: string
          detail: Json
          id: string
          step: string
        }
        Insert: {
          actor?: string | null
          actor_roles?: string[]
          created_at?: string
          decision_id: string
          detail?: Json
          id?: string
          step: string
        }
        Update: {
          actor?: string | null
          actor_roles?: string[]
          created_at?: string
          decision_id?: string
          detail?: Json
          id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_decision_audit_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "staff_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_decisions: {
        Row: {
          approver: string
          confidence: number | null
          coordination_key: string
          created_at: string
          deadline_at: string | null
          decided_at: string | null
          decided_by: string | null
          decision_rationale: string | null
          effective_class: string
          event_key: string
          evidence: Json
          expected_impact: Json
          id: string
          options: Json
          policy_key: string
          priority_score: number
          recommendation: string | null
          requested_by: string | null
          requested_class: string
          selected_option: string | null
          sla_class: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approver: string
          confidence?: number | null
          coordination_key: string
          created_at?: string
          deadline_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_rationale?: string | null
          effective_class: string
          event_key: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          options?: Json
          policy_key: string
          priority_score?: number
          recommendation?: string | null
          requested_by?: string | null
          requested_class: string
          selected_option?: string | null
          sla_class?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          approver?: string
          confidence?: number | null
          coordination_key?: string
          created_at?: string
          deadline_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_rationale?: string | null
          effective_class?: string
          event_key?: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          options?: Json
          policy_key?: string
          priority_score?: number
          recommendation?: string | null
          requested_by?: string | null
          requested_class?: string
          selected_option?: string | null
          sla_class?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_documents: {
        Row: {
          classification: string
          created_at: string
          description: string | null
          doc_type: string
          expiry_date: string | null
          file_name: string | null
          id: string
          issue_date: string | null
          mime_type: string | null
          rejection_reason: string | null
          staff_id: string
          storage_path: string | null
          supersedes_document_id: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          version: number
        }
        Insert: {
          classification?: string
          created_at?: string
          description?: string | null
          doc_type: string
          expiry_date?: string | null
          file_name?: string | null
          id?: string
          issue_date?: string | null
          mime_type?: string | null
          rejection_reason?: string | null
          staff_id: string
          storage_path?: string | null
          supersedes_document_id?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Update: {
          classification?: string
          created_at?: string
          description?: string | null
          doc_type?: string
          expiry_date?: string | null
          file_name?: string | null
          id?: string
          issue_date?: string | null
          mime_type?: string | null
          rejection_reason?: string | null
          staff_id?: string
          storage_path?: string | null
          supersedes_document_id?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_supersedes_document_id_fkey"
            columns: ["supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "staff_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_experiments: {
        Row: {
          baseline: string | null
          control: string | null
          created_at: string
          created_by: string | null
          decision: string | null
          domain: string
          expected_value: string | null
          hypothesis: string
          id: string
          measured_result: string | null
          measurement: string | null
          owner_role: string | null
          status: string
          title: string
          treatment: string | null
          updated_at: string
        }
        Insert: {
          baseline?: string | null
          control?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string | null
          domain: string
          expected_value?: string | null
          hypothesis: string
          id?: string
          measured_result?: string | null
          measurement?: string | null
          owner_role?: string | null
          status?: string
          title: string
          treatment?: string | null
          updated_at?: string
        }
        Update: {
          baseline?: string | null
          control?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string | null
          domain?: string
          expected_value?: string | null
          hypothesis?: string
          id?: string
          measured_result?: string | null
          measurement?: string | null
          owner_role?: string | null
          status?: string
          title?: string
          treatment?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      staff_focus_sessions: {
        Row: {
          actor_user_id: string | null
          actual_minutes: number | null
          created_at: string
          ended_at: string | null
          id: string
          interrupted: boolean
          outcome_note: string | null
          planned_minutes: number | null
          staff_id: string | null
          started_at: string
          work_item_id: string
        }
        Insert: {
          actor_user_id?: string | null
          actual_minutes?: number | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interrupted?: boolean
          outcome_note?: string | null
          planned_minutes?: number | null
          staff_id?: string | null
          started_at?: string
          work_item_id: string
        }
        Update: {
          actor_user_id?: string | null
          actual_minutes?: number | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interrupted?: boolean
          outcome_note?: string | null
          planned_minutes?: number | null
          staff_id?: string | null
          started_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_focus_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_focus_sessions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "staff_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_follow_up_tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string
          decision_reason: string | null
          due_date: string | null
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: string
          notes: string | null
          status: string
          title: string
          updated_at: string
          workflow_stage: string | null
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string
          decision_reason?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: string
          notes?: string | null
          status?: string
          title: string
          updated_at?: string
          workflow_stage?: string | null
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string
          decision_reason?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: string
          notes?: string | null
          status?: string
          title?: string
          updated_at?: string
          workflow_stage?: string | null
        }
        Relationships: []
      }
      staff_gaps: {
        Row: {
          closed_at: string | null
          created_at: string
          current_level: number | null
          detected_at: string
          evidence: Json
          gap_kind: string
          id: string
          label: string
          position_id: string | null
          required_level: number | null
          requirement_id: string | null
          severity: string
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          current_level?: number | null
          detected_at?: string
          evidence?: Json
          gap_kind: string
          id?: string
          label: string
          position_id?: string | null
          required_level?: number | null
          requirement_id?: string | null
          severity?: string
          staff_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          current_level?: number | null
          detected_at?: string
          evidence?: Json
          gap_kind?: string
          id?: string
          label?: string
          position_id?: string | null
          required_level?: number | null
          requirement_id?: string | null
          severity?: string
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_gaps_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "org_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_gaps_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "org_position_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_gaps_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_insight_feedback: {
        Row: {
          comment: string | null
          confidence_after: number | null
          confidence_before: number | null
          created_at: string
          id: string
          insight_key: string
          insight_title: string | null
          issue_type: string
          reporter_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_label: string | null
          status: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          confidence_after?: number | null
          confidence_before?: number | null
          created_at?: string
          id?: string
          insight_key: string
          insight_title?: string | null
          issue_type: string
          reporter_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_label?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          confidence_after?: number | null
          confidence_before?: number | null
          created_at?: string
          id?: string
          insight_key?: string
          insight_title?: string | null
          issue_type?: string
          reporter_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_label?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_intelligence_metrics: {
        Row: {
          batch_label: string
          created_at: string
          entity_key: string
          hint: string | null
          id: string
          metric_key: string
          metric_label: string
          period_end: string | null
          period_start: string | null
          source: string
          state: string
          surface: string
          unit: string | null
          updated_at: string
          value_text: string
        }
        Insert: {
          batch_label?: string
          created_at?: string
          entity_key?: string
          hint?: string | null
          id?: string
          metric_key: string
          metric_label: string
          period_end?: string | null
          period_start?: string | null
          source: string
          state?: string
          surface: string
          unit?: string | null
          updated_at?: string
          value_text: string
        }
        Update: {
          batch_label?: string
          created_at?: string
          entity_key?: string
          hint?: string | null
          id?: string
          metric_key?: string
          metric_label?: string
          period_end?: string | null
          period_start?: string | null
          source?: string
          state?: string
          surface?: string
          unit?: string | null
          updated_at?: string
          value_text?: string
        }
        Relationships: []
      }
      staff_kpi_actuals: {
        Row: {
          created_at: string
          id: string
          note: string | null
          objective_id: string
          period_end: string
          period_start: string
          recorded_by: string | null
          seed_batch: string | null
          source_ref: string | null
          source_type: string
          unit: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          objective_id: string
          period_end: string
          period_start: string
          recorded_by?: string | null
          seed_batch?: string | null
          source_ref?: string | null
          source_type: string
          unit: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          objective_id?: string
          period_end?: string
          period_start?: string
          recorded_by?: string | null
          seed_batch?: string | null
          source_ref?: string | null
          source_type?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_kpi_actuals_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "org_objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_lifecycle_events: {
        Row: {
          created_at: string
          effective_date: string
          event_kind: string
          from_value: string | null
          id: string
          notes: string | null
          recorded_by: string | null
          staff_id: string
          to_value: string | null
        }
        Insert: {
          created_at?: string
          effective_date?: string
          event_kind: string
          from_value?: string | null
          id?: string
          notes?: string | null
          recorded_by?: string | null
          staff_id: string
          to_value?: string | null
        }
        Update: {
          created_at?: string
          effective_date?: string
          event_kind?: string
          from_value?: string | null
          id?: string
          notes?: string | null
          recorded_by?: string | null
          staff_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_lifecycle_events_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_live_events: {
        Row: {
          created_at: string
          domain: string
          entity_id: string | null
          entity_type: string | null
          event_key: string
          id: string
          magnitude: number | null
          occurred_at: string
          payload: Json
          severity: string
          signature_verified: boolean
          source: string
        }
        Insert: {
          created_at?: string
          domain?: string
          entity_id?: string | null
          entity_type?: string | null
          event_key: string
          id?: string
          magnitude?: number | null
          occurred_at?: string
          payload?: Json
          severity?: string
          signature_verified?: boolean
          source: string
        }
        Update: {
          created_at?: string
          domain?: string
          entity_id?: string | null
          entity_type?: string | null
          event_key?: string
          id?: string
          magnitude?: number | null
          occurred_at?: string
          payload?: Json
          severity?: string
          signature_verified?: boolean
          source?: string
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          approval_limit_cents: number | null
          cost_centre: string | null
          created_at: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_status: string
          employment_type: string
          end_date: string | null
          full_name: string
          id: string
          languages: string[]
          location: string | null
          manager_staff_id: string | null
          national_id: string | null
          org_id: string
          personal_email: string | null
          phone: string | null
          photo_url: string | null
          position_id: string | null
          preferred_name: string | null
          provenance: string
          seed_batch: string | null
          skills: string[]
          staff_no: string
          start_date: string | null
          unit_id: string | null
          updated_at: string
          user_id: string | null
          work_email: string | null
          years_experience: number | null
        }
        Insert: {
          approval_limit_cents?: number | null
          cost_centre?: string | null
          created_at?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_status?: string
          employment_type?: string
          end_date?: string | null
          full_name: string
          id?: string
          languages?: string[]
          location?: string | null
          manager_staff_id?: string | null
          national_id?: string | null
          org_id: string
          personal_email?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          preferred_name?: string | null
          provenance?: string
          seed_batch?: string | null
          skills?: string[]
          staff_no: string
          start_date?: string | null
          unit_id?: string | null
          updated_at?: string
          user_id?: string | null
          work_email?: string | null
          years_experience?: number | null
        }
        Update: {
          approval_limit_cents?: number | null
          cost_centre?: string | null
          created_at?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_status?: string
          employment_type?: string
          end_date?: string | null
          full_name?: string
          id?: string
          languages?: string[]
          location?: string | null
          manager_staff_id?: string | null
          national_id?: string | null
          org_id?: string
          personal_email?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          preferred_name?: string | null
          provenance?: string
          seed_batch?: string | null
          skills?: string[]
          staff_no?: string
          start_date?: string | null
          unit_id?: string | null
          updated_at?: string
          user_id?: string | null
          work_email?: string | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_manager_staff_id_fkey"
            columns: ["manager_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "org_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notifications: {
        Row: {
          actor_staff_id: string | null
          actor_user_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          recipient_staff_id: string | null
          recipient_user_id: string | null
          review_id: string | null
          source_of_record: string
          source_record_id: string | null
          title: string
          work_item_id: string | null
        }
        Insert: {
          actor_staff_id?: string | null
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_staff_id?: string | null
          recipient_user_id?: string | null
          review_id?: string | null
          source_of_record?: string
          source_record_id?: string | null
          title: string
          work_item_id?: string | null
        }
        Update: {
          actor_staff_id?: string | null
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_staff_id?: string | null
          recipient_user_id?: string | null
          review_id?: string | null
          source_of_record?: string
          source_record_id?: string | null
          title?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_notifications_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_recipient_staff_id_fkey"
            columns: ["recipient_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "staff_work_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "staff_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_permission_grants: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          permission_key: string
          reason: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          permission_key: string
          reason?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          permission_key?: string
          reason?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_permissions: {
        Row: {
          action: string
          created_at: string
          description: string | null
          domain: string
          key: string
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          domain: string
          key: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          domain?: string
          key?: string
        }
        Relationships: []
      }
      staff_qualifications: {
        Row: {
          awarded_on: string | null
          created_at: string
          document_id: string | null
          expires_on: string | null
          id: string
          institution: string | null
          qualification_kind: string
          reference: string | null
          staff_id: string
          title: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          awarded_on?: string | null
          created_at?: string
          document_id?: string | null
          expires_on?: string | null
          id?: string
          institution?: string | null
          qualification_kind?: string
          reference?: string | null
          staff_id: string
          title: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          awarded_on?: string | null
          created_at?: string
          document_id?: string | null
          expires_on?: string | null
          id?: string
          institution?: string | null
          qualification_kind?: string
          reference?: string | null
          staff_id?: string
          title?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_qualifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "staff_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_qualifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_role_permissions: {
        Row: {
          created_at: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "staff_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      staff_saved_views: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          owner_id: string
          shared_roles: string[]
          updated_at: string
          visibility: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name: string
          owner_id?: string
          shared_roles?: string[]
          updated_at?: string
          visibility?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          shared_roles?: string[]
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      staff_training_needs: {
        Row: {
          assessment_passed: boolean | null
          assessment_score: number | null
          assigned_at: string | null
          assigned_by: string | null
          certificate_document_id: string | null
          completed_at: string | null
          course_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          gap_id: string | null
          id: string
          origin: string
          priority: string
          staff_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assessment_passed?: boolean | null
          assessment_score?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          certificate_document_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          gap_id?: string | null
          id?: string
          origin: string
          priority?: string
          staff_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assessment_passed?: boolean | null
          assessment_score?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          certificate_document_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          gap_id?: string | null
          id?: string
          origin?: string
          priority?: string
          staff_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_training_needs_certificate_document_id_fkey"
            columns: ["certificate_document_id"]
            isOneToOne: false
            referencedRelation: "staff_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_needs_gap_id_fkey"
            columns: ["gap_id"]
            isOneToOne: false
            referencedRelation: "staff_gaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_needs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_work_items: {
        Row: {
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_decision_note: string | null
          approval_reason: string | null
          approval_request_id: string | null
          approval_requested_at: string | null
          approval_requested_by: string | null
          approval_state: string
          assigned_at: string
          assigned_by: string | null
          closed_at: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          effort_basis: string | null
          effort_minutes: number | null
          entity_id: string | null
          entity_ref: string | null
          entity_type: string | null
          escalation_level: number
          id: string
          lifecycle_state: string
          needs_approval: boolean
          next_action: string | null
          next_action_due: string | null
          objective_id: string | null
          ops_queue: string | null
          outcome: string | null
          priority: string
          priority_band: string
          quality_flag: string | null
          required_action: string | null
          resolution: string | null
          resolution_notes: string | null
          review_state: string
          reviewed_at: string | null
          reviewer_staff_id: string | null
          seed_batch: string | null
          service_line: string | null
          sla_breached_at: string | null
          sla_due_at: string | null
          sla_minutes: number | null
          sla_started_at: string | null
          source_event_id: string | null
          source_id: string | null
          source_table: string | null
          staff_id: string | null
          started_at: string | null
          status: string
          title: string
          triage_score: number | null
          unit_id: string | null
          updated_at: string
          value_score: number | null
          work_kind: string
          writeback_applied_at: string | null
          writeback_outcome: string | null
          writeback_result: Json
        }
        Insert: {
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_decision_note?: string | null
          approval_reason?: string | null
          approval_request_id?: string | null
          approval_requested_at?: string | null
          approval_requested_by?: string | null
          approval_state?: string
          assigned_at?: string
          assigned_by?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          effort_basis?: string | null
          effort_minutes?: number | null
          entity_id?: string | null
          entity_ref?: string | null
          entity_type?: string | null
          escalation_level?: number
          id?: string
          lifecycle_state?: string
          needs_approval?: boolean
          next_action?: string | null
          next_action_due?: string | null
          objective_id?: string | null
          ops_queue?: string | null
          outcome?: string | null
          priority?: string
          priority_band?: string
          quality_flag?: string | null
          required_action?: string | null
          resolution?: string | null
          resolution_notes?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewer_staff_id?: string | null
          seed_batch?: string | null
          service_line?: string | null
          sla_breached_at?: string | null
          sla_due_at?: string | null
          sla_minutes?: number | null
          sla_started_at?: string | null
          source_event_id?: string | null
          source_id?: string | null
          source_table?: string | null
          staff_id?: string | null
          started_at?: string | null
          status?: string
          title: string
          triage_score?: number | null
          unit_id?: string | null
          updated_at?: string
          value_score?: number | null
          work_kind: string
          writeback_applied_at?: string | null
          writeback_outcome?: string | null
          writeback_result?: Json
        }
        Update: {
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_decision_note?: string | null
          approval_reason?: string | null
          approval_request_id?: string | null
          approval_requested_at?: string | null
          approval_requested_by?: string | null
          approval_state?: string
          assigned_at?: string
          assigned_by?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          effort_basis?: string | null
          effort_minutes?: number | null
          entity_id?: string | null
          entity_ref?: string | null
          entity_type?: string | null
          escalation_level?: number
          id?: string
          lifecycle_state?: string
          needs_approval?: boolean
          next_action?: string | null
          next_action_due?: string | null
          objective_id?: string | null
          ops_queue?: string | null
          outcome?: string | null
          priority?: string
          priority_band?: string
          quality_flag?: string | null
          required_action?: string | null
          resolution?: string | null
          resolution_notes?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewer_staff_id?: string | null
          seed_batch?: string | null
          service_line?: string | null
          sla_breached_at?: string | null
          sla_due_at?: string | null
          sla_minutes?: number | null
          sla_started_at?: string | null
          source_event_id?: string | null
          source_id?: string | null
          source_table?: string | null
          staff_id?: string | null
          started_at?: string | null
          status?: string
          title?: string
          triage_score?: number | null
          unit_id?: string | null
          updated_at?: string
          value_score?: number | null
          work_kind?: string
          writeback_applied_at?: string | null
          writeback_outcome?: string | null
          writeback_result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "staff_work_items_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "org_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_items_reviewer_staff_id_fkey"
            columns: ["reviewer_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_work_reviews: {
        Row: {
          created_at: string
          decision: string
          id: string
          quality_rating: string | null
          rationale: string
          required_action: string | null
          reviewer_staff_id: string | null
          reviewer_user_id: string | null
          source_of_record: string | null
          source_record_id: string | null
          staff_id: string | null
          work_item_id: string
        }
        Insert: {
          created_at?: string
          decision: string
          id?: string
          quality_rating?: string | null
          rationale: string
          required_action?: string | null
          reviewer_staff_id?: string | null
          reviewer_user_id?: string | null
          source_of_record?: string | null
          source_record_id?: string | null
          staff_id?: string | null
          work_item_id: string
        }
        Update: {
          created_at?: string
          decision?: string
          id?: string
          quality_rating?: string | null
          rationale?: string
          required_action?: string | null
          reviewer_staff_id?: string | null
          reviewer_user_id?: string | null
          source_of_record?: string | null
          source_record_id?: string | null
          staff_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_work_reviews_reviewer_staff_id_fkey"
            columns: ["reviewer_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_reviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_reviews_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "staff_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      support_assignment_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_agent_id: string | null
          id: string
          note: string | null
          source: string
          thread_id: string
          to_agent_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_agent_id?: string | null
          id?: string
          note?: string | null
          source?: string
          thread_id: string
          to_agent_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_agent_id?: string | null
          id?: string
          note?: string | null
          source?: string
          thread_id?: string
          to_agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_assignment_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          sender_role: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id?: string
          sender_role: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          sender_role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          assigned_agent_id: string | null
          assigned_at: string | null
          category: string
          created_at: string
          created_by: string
          id: string
          last_message_at: string | null
          rider_email: string
          rider_last_read_at: string | null
          rider_user_id: string | null
          staff_last_read_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          assigned_at?: string | null
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string | null
          rider_email: string
          rider_last_read_at?: string | null
          rider_user_id?: string | null
          staff_last_read_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          assigned_at?: string | null
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string | null
          rider_email?: string
          rider_last_read_at?: string | null
          rider_user_id?: string | null
          staff_last_read_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      suspicious_transactions: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id: string
          metadata: Json
          outcome: string | null
          reason: string
          reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          severity: Database["public"]["Enums"]["risk_event_severity"]
          source: string
          transaction_ref: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          metadata?: Json
          outcome?: string | null
          reason: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          source: string
          transaction_ref?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          metadata?: Json
          outcome?: string | null
          reason?: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          source?: string
          transaction_ref?: string | null
        }
        Relationships: []
      }
      tax_adjustments: {
        Row: {
          approved_by: string | null
          calculation_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          delta_cents: number
          id: string
          journal_id: string | null
          period_id: string | null
          reason: string
          scheme_id: string
        }
        Insert: {
          approved_by?: string | null
          calculation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delta_cents: number
          id?: string
          journal_id?: string | null
          period_id?: string | null
          reason: string
          scheme_id: string
        }
        Update: {
          approved_by?: string | null
          calculation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delta_cents?: number
          id?: string
          journal_id?: string | null
          period_id?: string | null
          reason?: string
          scheme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_adjustments_calculation_id_fkey"
            columns: ["calculation_id"]
            isOneToOne: false
            referencedRelation: "tax_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_adjustments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_adjustments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_adjustments_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_audit_logs: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          entity_id: string | null
          entity_kind: string
          event_type: Database["public"]["Enums"]["tax_audit_event"]
          id: string
          ip_address: unknown
          new_value: Json | null
          old_value: Json | null
          request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          entity_id?: string | null
          entity_kind: string
          event_type: Database["public"]["Enums"]["tax_audit_event"]
          id?: string
          ip_address?: unknown
          new_value?: Json | null
          old_value?: Json | null
          request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          entity_id?: string | null
          entity_kind?: string
          event_type?: Database["public"]["Enums"]["tax_audit_event"]
          id?: string
          ip_address?: unknown
          new_value?: Json | null
          old_value?: Json | null
          request_id?: string | null
        }
        Relationships: []
      }
      tax_calculations: {
        Row: {
          amount_cents: number
          calculated_at: string
          calculated_by: string | null
          currency: string
          id: string
          inputs: Json
          rate_id: string
          rate_snapshot: Json
          scheme_id: string
          source_id: string | null
          source_kind: string
          subject_user_id: string | null
          tax_cents: number
          total_cents: number
        }
        Insert: {
          amount_cents: number
          calculated_at?: string
          calculated_by?: string | null
          currency?: string
          id?: string
          inputs?: Json
          rate_id: string
          rate_snapshot: Json
          scheme_id: string
          source_id?: string | null
          source_kind: string
          subject_user_id?: string | null
          tax_cents: number
          total_cents: number
        }
        Update: {
          amount_cents?: number
          calculated_at?: string
          calculated_by?: string | null
          currency?: string
          id?: string
          inputs?: Json
          rate_id?: string
          rate_snapshot?: Json
          scheme_id?: string
          source_id?: string | null
          source_kind?: string
          subject_user_id?: string | null
          tax_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_calculations_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_calculations_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_exemptions: {
        Row: {
          active: boolean
          certificate_url: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          granted_by: string | null
          id: string
          reason: string
          revoked_by: string | null
          scheme_id: string
          subject_code: string | null
          subject_id: string | null
          subject_kind: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          certificate_url?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by?: string | null
          id?: string
          reason: string
          revoked_by?: string | null
          scheme_id: string
          subject_code?: string | null
          subject_id?: string | null
          subject_kind: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          certificate_url?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by?: string | null
          id?: string
          reason?: string
          revoked_by?: string | null
          scheme_id?: string
          subject_code?: string | null
          subject_id?: string | null
          subject_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_exemptions_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_frameworks: {
        Row: {
          active: boolean
          authority_name: string | null
          country_code: string
          created_at: string
          framework_code: string
          framework_name: string
          id: string
          metadata: Json
          vat_rate_bps: number | null
          withholding_rate_bps: number | null
        }
        Insert: {
          active?: boolean
          authority_name?: string | null
          country_code: string
          created_at?: string
          framework_code: string
          framework_name: string
          id?: string
          metadata?: Json
          vat_rate_bps?: number | null
          withholding_rate_bps?: number | null
        }
        Update: {
          active?: boolean
          authority_name?: string | null
          country_code?: string
          created_at?: string
          framework_code?: string
          framework_name?: string
          id?: string
          metadata?: Json
          vat_rate_bps?: number | null
          withholding_rate_bps?: number | null
        }
        Relationships: []
      }
      tax_invoice_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          invoice_id: string
          note: string | null
          status_after: string | null
          status_before: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          invoice_id: string
          note?: string | null
          status_after?: string | null
          status_before?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          invoice_id?: string
          note?: string | null
          status_after?: string | null
          status_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_invoice_lines: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_no: number
          qty: number
          service_date: string | null
          unit_rate_cents: number
          vehicle_category: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id: string
          line_no?: number
          qty?: number
          service_date?: string | null
          unit_rate_cents?: number
          vehicle_category?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_no?: number
          qty?: number
          service_date?: string | null
          unit_rate_cents?: number
          vehicle_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_invoices: {
        Row: {
          account_id: string | null
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          authorised_name: string | null
          authorised_title: string | null
          cancel_reason: string | null
          contract_id: string | null
          contract_reference: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_address: string | null
          customer_company: string
          customer_contact_person: string | null
          customer_email: string | null
          customer_phone: string | null
          customer_pin: string | null
          customer_ref: string | null
          due_date: string | null
          id: string
          invoice_no: string | null
          is_test: boolean
          issue_date: string | null
          issued_at: string | null
          lead_id: string | null
          lpo_reference: string | null
          notes: string | null
          owner_staff_id: string | null
          paid_cents: number
          payment_terms: string
          pdf_sha256: string | null
          proforma_id: string | null
          quote_reference: string | null
          sent_at: string | null
          sent_to: string | null
          service_from: string | null
          service_to: string | null
          sole_approver: boolean
          status: string
          submitted_at: string | null
          submitted_by: string | null
          subtotal_cents: number
          total_cents: number
          updated_at: string
          vat_cents: number
          vat_inclusive: boolean
          vat_rate: number
        }
        Insert: {
          account_id?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorised_name?: string | null
          authorised_title?: string | null
          cancel_reason?: string | null
          contract_id?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_company?: string
          customer_contact_person?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          customer_pin?: string | null
          customer_ref?: string | null
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          is_test?: boolean
          issue_date?: string | null
          issued_at?: string | null
          lead_id?: string | null
          lpo_reference?: string | null
          notes?: string | null
          owner_staff_id?: string | null
          paid_cents?: number
          payment_terms?: string
          pdf_sha256?: string | null
          proforma_id?: string | null
          quote_reference?: string | null
          sent_at?: string | null
          sent_to?: string | null
          service_from?: string | null
          service_to?: string | null
          sole_approver?: boolean
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          vat_cents?: number
          vat_inclusive?: boolean
          vat_rate?: number
        }
        Update: {
          account_id?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorised_name?: string | null
          authorised_title?: string | null
          cancel_reason?: string | null
          contract_id?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_company?: string
          customer_contact_person?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          customer_pin?: string | null
          customer_ref?: string | null
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          is_test?: boolean
          issue_date?: string | null
          issued_at?: string | null
          lead_id?: string | null
          lpo_reference?: string | null
          notes?: string | null
          owner_staff_id?: string | null
          paid_cents?: number
          payment_terms?: string
          pdf_sha256?: string | null
          proforma_id?: string | null
          quote_reference?: string | null
          sent_at?: string | null
          sent_to?: string | null
          service_from?: string | null
          service_to?: string | null
          sole_approver?: boolean
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          vat_cents?: number
          vat_inclusive?: boolean
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoices_proforma_id_fkey"
            columns: ["proforma_id"]
            isOneToOne: false
            referencedRelation: "proforma_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_periods: {
        Row: {
          cadence: string
          created_at: string
          filed_at: string | null
          filed_by: string | null
          id: string
          jurisdiction: string
          period_end: string
          period_start: string
          scheme_id: string
          status: Database["public"]["Enums"]["tax_period_status"]
          updated_at: string
        }
        Insert: {
          cadence: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          jurisdiction?: string
          period_end: string
          period_start: string
          scheme_id: string
          status?: Database["public"]["Enums"]["tax_period_status"]
          updated_at?: string
        }
        Update: {
          cadence?: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          jurisdiction?: string
          period_end?: string
          period_start?: string
          scheme_id?: string
          status?: Database["public"]["Enums"]["tax_period_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_periods_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction: string
          notes: string | null
          rate_bps: number
          scheme_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          jurisdiction?: string
          notes?: string | null
          rate_bps: number
          scheme_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          jurisdiction?: string
          notes?: string | null
          rate_bps?: number
          scheme_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_reconciliations: {
        Row: {
          created_at: string
          details: Json
          etims_total_cents: number
          id: string
          kra_total_cents: number
          ledger_total_cents: number
          period_id: string
          run_by: string | null
          scheme_id: string
          status: Database["public"]["Enums"]["tax_reconciliation_status"]
          variance_cents: number
        }
        Insert: {
          created_at?: string
          details?: Json
          etims_total_cents?: number
          id?: string
          kra_total_cents?: number
          ledger_total_cents?: number
          period_id: string
          run_by?: string | null
          scheme_id: string
          status?: Database["public"]["Enums"]["tax_reconciliation_status"]
          variance_cents?: number
        }
        Update: {
          created_at?: string
          details?: Json
          etims_total_cents?: number
          id?: string
          kra_total_cents?: number
          ledger_total_cents?: number
          period_id?: string
          run_by?: string | null
          scheme_id?: string
          status?: Database["public"]["Enums"]["tax_reconciliation_status"]
          variance_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_reconciliations_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_reconciliations_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_report_sync_runs: {
        Row: {
          attempt: number
          backoff_ms: number | null
          created_at: string
          duration_ms: number | null
          id: string
          last_error: Json | null
          report: string
          request_id: string
          status: string
          trigger_source: string
          triggered_by: string | null
          triggered_by_email: string | null
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          attempt?: number
          backoff_ms?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          last_error?: Json | null
          report: string
          request_id: string
          status: string
          trigger_source: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          attempt?: number
          backoff_ms?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          last_error?: Json | null
          report?: string
          request_id?: string
          status?: string
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: []
      }
      tax_rules: {
        Row: {
          active: boolean
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          predicate: Json
          priority: number
          rule_code: string
          scheme_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          predicate?: Json
          priority?: number
          rule_code: string
          scheme_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          predicate?: Json
          priority?: number
          rule_code?: string
          scheme_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_rules_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_schemes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          jurisdiction: string
          kind: Database["public"]["Enums"]["tax_scheme_kind"]
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          jurisdiction?: string
          kind: Database["public"]["Enums"]["tax_scheme_kind"]
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          jurisdiction?: string
          kind?: Database["public"]["Enums"]["tax_scheme_kind"]
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_submissions: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          currency: string
          id: string
          kra_reference: string | null
          kra_response: Json | null
          notes: string | null
          payload: Json
          period_id: string
          scheme_id: string
          status: Database["public"]["Enums"]["tax_submission_status"]
          submission_type: string
          submitted_at: string | null
          submitted_by: string | null
          total_tax_cents: number
          total_taxable_cents: number
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          kra_reference?: string | null
          kra_response?: Json | null
          notes?: string | null
          payload?: Json
          period_id: string
          scheme_id: string
          status?: Database["public"]["Enums"]["tax_submission_status"]
          submission_type: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_tax_cents?: number
          total_taxable_cents?: number
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          kra_reference?: string | null
          kra_response?: Json | null
          notes?: string | null
          payload?: Json
          period_id?: string
          scheme_id?: string
          status?: Database["public"]["Enums"]["tax_submission_status"]
          submission_type?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_tax_cents?: number
          total_taxable_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_submissions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_submissions_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "tax_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_taxes: {
        Row: {
          calculation_id: string
          created_at: string
          currency: string
          id: string
          journal_id: string | null
          mpesa_transaction_id: string | null
          scheme_code: string
          tax_cents: number
          wallet_transaction_id: string | null
        }
        Insert: {
          calculation_id: string
          created_at?: string
          currency?: string
          id?: string
          journal_id?: string | null
          mpesa_transaction_id?: string | null
          scheme_code: string
          tax_cents: number
          wallet_transaction_id?: string | null
        }
        Update: {
          calculation_id?: string
          created_at?: string
          currency?: string
          id?: string
          journal_id?: string | null
          mpesa_transaction_id?: string | null
          scheme_code?: string
          tax_cents?: number
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_taxes_calculation_id_fkey"
            columns: ["calculation_id"]
            isOneToOne: false
            referencedRelation: "tax_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_taxes_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_taxes_mpesa_transaction_id_fkey"
            columns: ["mpesa_transaction_id"]
            isOneToOne: false
            referencedRelation: "mpesa_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_taxes_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_accounts: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["treasury_account_kind"]
          ledger_account_id: string | null
          name: string
          provider: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          kind: Database["public"]["Enums"]["treasury_account_kind"]
          ledger_account_id?: string | null
          name: string
          provider?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["treasury_account_kind"]
          ledger_account_id?: string | null
          name?: string
          provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_accounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "treasury_accounts_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_bookings: {
        Row: {
          booking_number: string
          business_request_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          driver_id: string | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          intent: string | null
          passenger_count: number
          payment_method: string | null
          pickup_address: string
          pickup_eta: string | null
          pickup_lat: number
          pickup_lng: number
          ride_type_id: string | null
          rider_user_id: string
          scheduled_for: string | null
          started_at: string | null
          status: string
          surge_multiplier: number | null
          total_fare: number | null
          trip_quote_id: string | null
          trip_request_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          booking_number?: string
          business_request_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          driver_id?: string | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id?: string
          intent?: string | null
          passenger_count?: number
          payment_method?: string | null
          pickup_address: string
          pickup_eta?: string | null
          pickup_lat: number
          pickup_lng: number
          ride_type_id?: string | null
          rider_user_id: string
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          surge_multiplier?: number | null
          total_fare?: number | null
          trip_quote_id?: string | null
          trip_request_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          booking_number?: string
          business_request_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          driver_id?: string | null
          dropoff_address?: string
          dropoff_lat?: number
          dropoff_lng?: number
          id?: string
          intent?: string | null
          passenger_count?: number
          payment_method?: string | null
          pickup_address?: string
          pickup_eta?: string | null
          pickup_lat?: number
          pickup_lng?: number
          ride_type_id?: string | null
          rider_user_id?: string
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          surge_multiplier?: number | null
          total_fare?: number | null
          trip_quote_id?: string | null
          trip_request_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_bookings_business_request_id_fkey"
            columns: ["business_request_id"]
            isOneToOne: false
            referencedRelation: "business_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_bookings_ride_type_id_fkey"
            columns: ["ride_type_id"]
            isOneToOne: false
            referencedRelation: "ride_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_bookings_trip_quote_id_fkey"
            columns: ["trip_quote_id"]
            isOneToOne: false
            referencedRelation: "trip_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_bookings_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_incidents: {
        Row: {
          created_at: string
          description: string | null
          evidence_urls: string[] | null
          id: string
          incident_type: string
          lat: number | null
          lng: number | null
          reporter_user_id: string
          resolved_at: string | null
          severity: string
          status: string
          trip_booking_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          evidence_urls?: string[] | null
          id?: string
          incident_type: string
          lat?: number | null
          lng?: number | null
          reporter_user_id: string
          resolved_at?: string | null
          severity?: string
          status?: string
          trip_booking_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          evidence_urls?: string[] | null
          id?: string
          incident_type?: string
          lat?: number | null
          lng?: number | null
          reporter_user_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          trip_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_incidents_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_quotes: {
        Row: {
          base_fare: number | null
          created_at: string
          discount: number | null
          distance_fare: number | null
          distance_km: number | null
          duration_min: number | null
          expires_at: string
          id: string
          ride_type_id: string | null
          surge_multiplier: number | null
          taxes: number | null
          time_fare: number | null
          total_fare: number
          trip_request_id: string
        }
        Insert: {
          base_fare?: number | null
          created_at?: string
          discount?: number | null
          distance_fare?: number | null
          distance_km?: number | null
          duration_min?: number | null
          expires_at?: string
          id?: string
          ride_type_id?: string | null
          surge_multiplier?: number | null
          taxes?: number | null
          time_fare?: number | null
          total_fare: number
          trip_request_id: string
        }
        Update: {
          base_fare?: number | null
          created_at?: string
          discount?: number | null
          distance_fare?: number | null
          distance_km?: number | null
          duration_min?: number | null
          expires_at?: string
          id?: string
          ride_type_id?: string | null
          surge_multiplier?: number | null
          taxes?: number | null
          time_fare?: number | null
          total_fare?: number
          trip_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_quotes_ride_type_id_fkey"
            columns: ["ride_type_id"]
            isOneToOne: false
            referencedRelation: "ride_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_quotes_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_ratings: {
        Row: {
          cleanliness: number | null
          comment: string | null
          created_at: string
          driving: number | null
          id: string
          overall: number
          professionalism: number | null
          ratee_kind: string
          rater_user_id: string
          safety: number | null
          trip_booking_id: string
        }
        Insert: {
          cleanliness?: number | null
          comment?: string | null
          created_at?: string
          driving?: number | null
          id?: string
          overall: number
          professionalism?: number | null
          ratee_kind: string
          rater_user_id: string
          safety?: number | null
          trip_booking_id: string
        }
        Update: {
          cleanliness?: number | null
          comment?: string | null
          created_at?: string
          driving?: number | null
          id?: string
          overall?: number
          professionalism?: number | null
          ratee_kind?: string
          rater_user_id?: string
          safety?: number | null
          trip_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_ratings_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_requests: {
        Row: {
          created_at: string
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          estimated_distance_km: number | null
          estimated_duration_min: number | null
          estimated_fare: number | null
          id: string
          intent: string | null
          passenger_count: number
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          requested_at: string
          ride_type_id: string | null
          rider_user_id: string
          status: string
          surge_multiplier: number | null
        }
        Insert: {
          created_at?: string
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          estimated_distance_km?: number | null
          estimated_duration_min?: number | null
          estimated_fare?: number | null
          id?: string
          intent?: string | null
          passenger_count?: number
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          requested_at?: string
          ride_type_id?: string | null
          rider_user_id: string
          status?: string
          surge_multiplier?: number | null
        }
        Update: {
          created_at?: string
          dropoff_address?: string
          dropoff_lat?: number
          dropoff_lng?: number
          estimated_distance_km?: number | null
          estimated_duration_min?: number | null
          estimated_fare?: number | null
          id?: string
          intent?: string | null
          passenger_count?: number
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          requested_at?: string
          ride_type_id?: string | null
          rider_user_id?: string
          status?: string
          surge_multiplier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_requests_ride_type_id_fkey"
            columns: ["ride_type_id"]
            isOneToOne: false
            referencedRelation: "ride_types"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_share_links: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          trip_booking_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          trip_booking_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          trip_booking_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_share_links_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string
          trip_booking_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status: string
          trip_booking_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string
          trip_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_status_history_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_tracking: {
        Row: {
          eta_seconds: number | null
          heading: number | null
          id: string
          lat: number
          lng: number
          recorded_at: string
          speed_kmh: number | null
          trip_booking_id: string
        }
        Insert: {
          eta_seconds?: number | null
          heading?: number | null
          id?: string
          lat: number
          lng: number
          recorded_at?: string
          speed_kmh?: number | null
          trip_booking_id: string
        }
        Update: {
          eta_seconds?: number | null
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          speed_kmh?: number | null
          trip_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_tracking_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_waypoints: {
        Row: {
          address: string
          arrived_at: string | null
          departed_at: string | null
          id: string
          lat: number
          lng: number
          seq: number
          trip_booking_id: string
        }
        Insert: {
          address: string
          arrived_at?: string | null
          departed_at?: string | null
          id?: string
          lat: number
          lng: number
          seq: number
          trip_booking_id: string
        }
        Update: {
          address?: string
          arrived_at?: string | null
          departed_at?: string | null
          id?: string
          lat?: number
          lng?: number
          seq?: number
          trip_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_waypoints_trip_booking_id_fkey"
            columns: ["trip_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_alert_prefs: {
        Row: {
          circuit_email: boolean
          circuit_toast: boolean
          created_at: string
          decision_request_email: boolean
          decision_request_portal: boolean
          integration_email: boolean
          integration_toast: boolean
          min_severity: string
          muted_integrations: Json
          quiet_allow_critical: boolean
          quiet_end_minute: number
          quiet_hours_enabled: boolean
          quiet_start_minute: number
          sla_email: boolean
          sla_toast: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          circuit_email?: boolean
          circuit_toast?: boolean
          created_at?: string
          decision_request_email?: boolean
          decision_request_portal?: boolean
          integration_email?: boolean
          integration_toast?: boolean
          min_severity?: string
          muted_integrations?: Json
          quiet_allow_critical?: boolean
          quiet_end_minute?: number
          quiet_hours_enabled?: boolean
          quiet_start_minute?: number
          sla_email?: boolean
          sla_toast?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          circuit_email?: boolean
          circuit_toast?: boolean
          created_at?: string
          decision_request_email?: boolean
          decision_request_portal?: boolean
          integration_email?: boolean
          integration_toast?: boolean
          min_severity?: string
          muted_integrations?: Json
          quiet_allow_critical?: boolean
          quiet_end_minute?: number
          quiet_hours_enabled?: boolean
          quiet_start_minute?: number
          sla_email?: boolean
          sla_toast?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          granted_by: string | null
          id: string
          metadata: Json
          reason: string | null
          region_id: string | null
          revoked_at: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          region_id?: string | null
          revoked_at?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          region_id?: string | null
          revoked_at?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          driver_id: string
          id: string
          make: string | null
          model: string | null
          plate_number: string
          ride_type_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          driver_id: string
          id?: string
          make?: string | null
          model?: string | null
          plate_number: string
          ride_type_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          make?: string | null
          model?: string | null
          plate_number?: string
          ride_type_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_ride_type_id_fkey"
            columns: ["ride_type_id"]
            isOneToOne: false
            referencedRelation: "ride_types"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_abuse_cases: {
        Row: {
          abuse_type: string
          assigned_to: string | null
          case_number: string
          created_at: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id: string
          notes: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["risk_event_severity"]
          signals: Json
          status: Database["public"]["Enums"]["fraud_review_status"]
          total_amount: number | null
          updated_at: string
          velocity_count: number | null
          velocity_window: string | null
          wallet_ref: string | null
        }
        Insert: {
          abuse_type: string
          assigned_to?: string | null
          case_number?: string
          created_at?: string
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          notes?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          signals?: Json
          status?: Database["public"]["Enums"]["fraud_review_status"]
          total_amount?: number | null
          updated_at?: string
          velocity_count?: number | null
          velocity_window?: string | null
          wallet_ref?: string | null
        }
        Update: {
          abuse_type?: string
          assigned_to?: string | null
          case_number?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["risk_entity_type"]
          id?: string
          notes?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["risk_event_severity"]
          signals?: Json
          status?: Database["public"]["Enums"]["fraud_review_status"]
          total_amount?: number | null
          updated_at?: string
          velocity_count?: number | null
          velocity_window?: string | null
          wallet_ref?: string | null
        }
        Relationships: []
      }
      wallet_freezes: {
        Row: {
          active: boolean
          case_id: string | null
          corporate_id: string | null
          created_at: string
          freeze_type: string
          id: string
          initiated_by: string | null
          initiated_by_system: boolean
          reason: string
          reconciliation_id: string | null
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          wallet_id: string | null
        }
        Insert: {
          active?: boolean
          case_id?: string | null
          corporate_id?: string | null
          created_at?: string
          freeze_type?: string
          id?: string
          initiated_by?: string | null
          initiated_by_system?: boolean
          reason: string
          reconciliation_id?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          wallet_id?: string | null
        }
        Update: {
          active?: boolean
          case_id?: string | null
          corporate_id?: string | null
          created_at?: string
          freeze_type?: string
          id?: string
          initiated_by?: string | null
          initiated_by_system?: boolean
          reason?: string
          reconciliation_id?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_freezes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_freezes_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_freezes_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "corporate_financial_reconciliation"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_reconciliation: {
        Row: {
          closing_balance: number
          created_at: string
          credits: number
          debits: number
          expected_balance: number
          id: string
          notes: string | null
          opening_balance: number
          period_end: string
          period_start: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          updated_at: string
          variance: number | null
          wallet_id: string
        }
        Insert: {
          closing_balance: number
          created_at?: string
          credits?: number
          debits?: number
          expected_balance: number
          id?: string
          notes?: string | null
          opening_balance: number
          period_end: string
          period_start: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
          variance?: number | null
          wallet_id: string
        }
        Update: {
          closing_balance?: number
          created_at?: string
          credits?: number
          debits?: number
          expected_balance?: number
          id?: string
          notes?: string | null
          opening_balance?: number
          period_end?: string
          period_start?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
          variance?: number | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_reconciliation_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount_cents: number
          created_at: string
          direction: Database["public"]["Enums"]["txn_direction"]
          id: string
          kind: Database["public"]["Enums"]["txn_kind"]
          metadata: Json
          mpesa_receipt: string | null
          reference: string | null
          status: Database["public"]["Enums"]["txn_status"]
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          direction: Database["public"]["Enums"]["txn_direction"]
          id?: string
          kind: Database["public"]["Enums"]["txn_kind"]
          metadata?: Json
          mpesa_receipt?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["txn_direction"]
          id?: string
          kind?: Database["public"]["Enums"]["txn_kind"]
          metadata?: Json
          mpesa_receipt?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance_cents: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
          wallet_type: Database["public"]["Enums"]["wallet_type"]
        }
        Insert: {
          balance_cents?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
          wallet_type?: Database["public"]["Enums"]["wallet_type"]
        }
        Update: {
          balance_cents?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
          wallet_type?: Database["public"]["Enums"]["wallet_type"]
        }
        Relationships: []
      }
      yalla_payment_channels: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          branch: string | null
          channel_type: string
          created_at: string
          currency: string
          display_name: string
          id: string
          is_active: boolean
          paybill_number: string | null
          reference_instructions: string
          source_document: string | null
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          channel_type: string
          created_at?: string
          currency?: string
          display_name: string
          id?: string
          is_active?: boolean
          paybill_number?: string | null
          reference_instructions?: string
          source_document?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          channel_type?: string
          created_at?: string
          currency?: string
          display_name?: string
          id?: string
          is_active?: boolean
          paybill_number?: string | null
          reference_instructions?: string
          source_document?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_assign_business_request: {
        Args: { _driver_id: string; _fare?: number; _request_id: string }
        Returns: string
      }
      admin_assign_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: undefined
      }
      admin_review_business_organisation: {
        Args: { _organisation_id: string; _status: string }
        Returns: undefined
      }
      admin_revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: undefined
      }
      admin_update_business_request: {
        Args: { _admin_notes?: string; _request_id: string; _status: string }
        Returns: undefined
      }
      credit_wallet: {
        Args: { _amount_cents: number; _wallet_id: string }
        Returns: undefined
      }
      debit_wallet: {
        Args: { _amount_cents: number; _wallet_id: string }
        Returns: boolean
      }
      driver_accept_trip: { Args: { _booking_id: string }; Returns: undefined }
      driver_set_vehicle_status: {
        Args: { _status: string; _vehicle_id: string }
        Returns: undefined
      }
      driver_update_trip_status: {
        Args: { _booking_id: string; _status: string }
        Returns: undefined
      }
      ensure_rider_account: { Args: never; Returns: undefined }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_support_agents: {
        Args: never
        Returns: {
          email: string
          open_cases: number
          user_id: string
        }[]
      }
      next_commercial_action_id: { Args: never; Returns: string }
      next_commercial_transaction_id: { Args: never; Returns: string }
      safety_raise_sos: {
        Args: {
          _booking_id: string
          _lat: number
          _lng: number
          _message?: string
        }
        Returns: string
      }
      trip_assign_driver: { Args: { _booking_id: string }; Returns: Json }
      trip_cancel_booking: {
        Args: { _booking_id: string; _reason?: string }
        Returns: undefined
      }
      trip_confirm_booking: {
        Args: {
          _payment_method?: string
          _quote_id: string
          _scheduled_for?: string
        }
        Returns: string
      }
      trip_driver_card: { Args: { _booking_id: string }; Returns: Json }
      trip_quote_fare: {
        Args: {
          _distance_km: number
          _duration_min: number
          _request_id: string
        }
        Returns: {
          quote_id: string
          total: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "support"
        | "rider"
        | "driver"
        | "corporate_admin"
        | "corporate_employee"
        | "finance_admin"
        | "super_admin"
      approval_request_status:
        | "PENDING"
        | "IN_REVIEW"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
        | "EXPIRED"
        | "ESCALATED"
      bank_guarantee_state:
        | "UPLOADED"
        | "VALIDATING"
        | "DOCUMENT_VERIFICATION"
        | "BANK_VERIFICATION"
        | "PENDING_APPROVAL"
        | "APPROVED"
        | "ACTIVE"
        | "SUSPENDED"
        | "EXPIRING"
        | "EXPIRED"
        | "REVOKED"
        | "REJECTED"
      budget_reservation_status:
        | "RESERVED"
        | "CONSUMED"
        | "RELEASED"
        | "EXPIRED"
      budget_status: "DRAFT" | "ACTIVE" | "LOCKED" | "CLOSED" | "OVERSPENT"
      capacity_availability_state:
        | "CONFIGURED"
        | "AVAILABLE"
        | "SUSPENDED"
        | "EXPIRED"
        | "CANCELLED"
      capacity_reservation_state:
        | "ACTIVE"
        | "COMMITTED"
        | "CONSUMED"
        | "RELEASED"
        | "EXPIRED"
        | "CANCELLED"
      carrier_contract_status:
        | "NONE"
        | "DRAFT"
        | "SIGNED"
        | "EXPIRED"
        | "TERMINATED"
      carrier_operating_status:
        | "ONBOARDING"
        | "ACTIVE"
        | "SUSPENDED"
        | "OFFBOARDED"
      carrier_quote_state:
        | "DRAFT"
        | "SUBMITTED"
        | "SUPERSEDED"
        | "ACCEPTED"
        | "REJECTED"
        | "WITHDRAWN"
        | "EXPIRED"
      corp_ledger_entry_type:
        | "top_up"
        | "ride_charge"
        | "refund"
        | "adjustment"
        | "reversal"
      corporate_invoice_status:
        | "DRAFT"
        | "ISSUED"
        | "PARTIALLY_PAID"
        | "PAID"
        | "OVERDUE"
        | "VOIDED"
      corporate_period_status:
        | "OPEN"
        | "LOCKED"
        | "BILLED"
        | "SETTLED"
        | "CANCELLED"
      corporate_status: "ACTIVE" | "SUSPENDED" | "CLOSED"
      cost_center_status: "ACTIVE" | "FROZEN" | "ARCHIVED"
      credit_facility_state:
        | "DRAFT"
        | "ACTIVE"
        | "SUSPENDED"
        | "EXPIRED"
        | "CLOSED"
      credit_reservation_state: "ACTIVE" | "UTILIZED" | "RELEASED" | "EXPIRED"
      dispute_reason:
        | "FRAUD"
        | "DUPLICATE"
        | "SERVICE_NOT_RENDERED"
        | "OVERCHARGE"
        | "UNAUTHORIZED"
        | "OTHER"
      dispute_status:
        | "OPEN"
        | "INVESTIGATING"
        | "PENDING"
        | "RESOLVED"
        | "REJECTED"
        | "ESCALATED"
      driver_etims_invoice_status:
        | "PENDING"
        | "SUBMITTED"
        | "ACCEPTED"
        | "REJECTED"
        | "RETRYING"
        | "FAILED"
        | "VOIDED"
        | "REFUNDED"
      driver_payout_batch_status:
        | "OPEN"
        | "LOCKED"
        | "SUBMITTED"
        | "SETTLED"
        | "RECONCILED"
        | "FAILED"
      driver_payout_method_type: "MPESA" | "BANK_TRANSFER" | "CARD"
      driver_payout_status:
        | "PENDING"
        | "QUEUED"
        | "PROCESSING"
        | "SUCCESS"
        | "FAILED"
        | "REVERSED"
        | "CANCELLED"
      driver_tax_liability_status:
        | "OPEN"
        | "PARTIAL"
        | "PAID"
        | "OVERDUE"
        | "WAIVED"
      driver_tax_profile_status:
        | "PENDING"
        | "ACTIVE"
        | "SUSPENDED"
        | "DEREGISTERED"
      driver_tax_regime: "TOT" | "INCOME_TAX" | "PAYE" | "EXEMPT"
      driver_tax_return_status:
        | "DRAFT"
        | "FILED"
        | "ACCEPTED"
        | "REJECTED"
        | "AMENDED"
      driver_type: "individual" | "fleet_driver" | "corporate_driver"
      etims_invoice_status:
        | "PENDING"
        | "SYNCING"
        | "RETRYING"
        | "SYNCED"
        | "FAILED"
        | "VOIDED"
        | "REFUNDED"
      etims_invoice_type: "SALE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "REFUND"
      fin_ledger_entry_kind:
        | "BOOKING"
        | "PAYMENT"
        | "RECEIVABLE"
        | "CREDIT_UTILISATION"
        | "RECONCILIATION"
        | "ADJUSTMENT"
      fraud_review_status:
        | "open"
        | "reviewing"
        | "confirmed"
        | "dismissed"
        | "escalated"
      freight_alloc_state:
        | "ALLOCATED"
        | "PARTIAL"
        | "OVERPAYMENT"
        | "UNDERPAYMENT"
        | "UNMATCHED"
        | "REVERSED"
        | "DUPLICATE"
      freight_booking_state:
        | "CREATED"
        | "CARRIER_ASSIGNED"
        | "RESOURCED"
        | "DISPATCHED"
        | "EXECUTING"
        | "COMPLETED"
        | "CANCELLED"
        | "FAILED"
      freight_charge_party: "CUSTOMER" | "CARRIER"
      freight_charge_status:
        | "CALCULATED"
        | "PENDING_REVIEW"
        | "APPROVED"
        | "INVOICED"
        | "PAID"
        | "SETTLED"
        | "VOID"
      freight_invoice_status:
        | "DRAFT"
        | "ISSUED"
        | "PARTIALLY_PAID"
        | "PAID"
        | "VOID"
      freight_pricing_basis:
        | "PER_SHIPMENT"
        | "PER_PACKAGE"
        | "PER_KG"
        | "PER_KM"
        | "PER_TRIP"
        | "PER_LOAD"
        | "PER_PALLET"
        | "PER_CONTAINER"
        | "CONTRACT_RATE"
      freight_quote_status:
        | "DRAFT"
        | "ISSUED"
        | "ACCEPTED"
        | "EXPIRED"
        | "SUPERSEDED"
        | "WITHDRAWN"
        | "REJECTED"
      freight_requirement_state:
        | "DRAFT"
        | "SUBMITTED"
        | "SOURCING"
        | "AWARDED"
        | "BOOKED"
        | "FULFILLED"
        | "CANCELLED"
      freight_settlement_status:
        | "CALCULATED"
        | "PENDING_REVIEW"
        | "APPROVED"
        | "PAID"
        | "REVERSED"
      fx_rate_type: "SPOT" | "DAILY" | "HISTORICAL" | "CLOSING"
      journal_source:
        | "MPESA_SETTLEMENT"
        | "MPESA_REVERSAL"
        | "DRIVER_PAYOUT"
        | "CORPORATE_TRANSFER"
        | "RIDE_COMPLETION"
        | "MANUAL_ADJUSTMENT"
        | "FX_REVALUATION"
        | "SETTLEMENT_BATCH"
        | "OTHER"
      journal_status: "DRAFT" | "POSTED" | "REVERSED"
      ledger_account_kind:
        | "ASSET"
        | "LIABILITY"
        | "EQUITY"
        | "REVENUE"
        | "EXPENSE"
        | "CLEARING"
        | "WALLET"
      ledger_direction: "DEBIT" | "CREDIT"
      mobility_order_status:
        | "DRAFT"
        | "QUOTE_REQUESTED"
        | "QUOTED"
        | "CUSTOMER_APPROVAL"
        | "PAYMENT_PENDING"
        | "CONFIRMED"
        | "ALLOCATING"
        | "ASSIGNED"
        | "EN_ROUTE"
        | "IN_SERVICE"
        | "COMPLETED"
        | "RECONCILING"
        | "SETTLED"
        | "CANCELLED"
        | "FAILED"
        | "REASSIGNMENT_REQUIRED"
        | "SUPPLIER_NO_SHOW"
        | "CUSTOMER_NO_SHOW"
        | "DISPUTED"
        | "REFUNDED"
      mobility_service_type:
        | "RIDE"
        | "CHARTER"
        | "DELIVERY"
        | "LOGISTICS"
        | "AIR_CHARTER"
        | "MARINE"
        | "RENTAL"
        | "LEASING"
        | "MULTI_SERVICE"
      mpesa_status: "pending" | "success" | "failed"
      partner_commercial_model:
        | "REFER"
        | "BOOK"
        | "EMBED"
        | "API"
        | "WHITE_LABEL"
        | "ORCHESTRATE"
      partner_commission_model:
        | "NET_RATE"
        | "MARKUP"
        | "COMMISSION"
        | "REVENUE_SHARE"
        | "FIXED_FEE"
        | "TIERED_RATE"
        | "CONTRACT_RATE"
        | "CUSTOM"
      partner_ledger_kind:
        | "wallet_topup"
        | "order_hold"
        | "order_capture"
        | "order_release"
        | "partner_margin"
        | "yalla_margin"
        | "tax"
        | "supplier_cost"
        | "settlement_payout"
        | "adjustment"
        | "reversal"
      partner_onboarding_stage:
        | "applied"
        | "screening"
        | "documents_pending"
        | "documents_review"
        | "contracting"
        | "activation"
        | "verified"
        | "rejected"
        | "suspended"
      partner_settlement_state:
        | "open"
        | "pending_review"
        | "approved"
        | "paid"
        | "reconciled"
        | "disputed"
      partner_status:
        | "draft"
        | "pending"
        | "active"
        | "suspended"
        | "terminated"
      partner_type:
        | "TOUR_OPERATOR"
        | "DMC"
        | "TRAVEL_AGENCY"
        | "HOTEL"
        | "AIRLINE"
        | "AIR_CHARTER"
        | "CORPORATE"
        | "EVENT"
        | "ECOMMERCE"
        | "RETAIL"
        | "COURIER"
        | "LOGISTICS"
        | "NGO"
        | "SCHOOL"
        | "GOVERNMENT"
        | "TRAVEL_PLATFORM"
        | "OTHER"
      partner_verification_status:
        | "unverified"
        | "in_review"
        | "verified"
        | "rejected"
        | "expired"
      payment_audit_event:
        | "INSERT"
        | "UPDATE"
        | "STATUS_CHANGE"
        | "REVERSAL"
        | "RECONCILIATION"
        | "EXPORT"
        | "DELETE_REQUEST"
        | "SOFT_DELETE"
      payment_decision_type:
        | "ALLOW_CASH_PAYMENT"
        | "ALLOW_GUARANTEED_CREDIT"
        | "PAYMENT_REQUIRED"
        | "APPROVAL_REQUIRED"
        | "CREDIT_UNAVAILABLE"
        | "GUARANTEE_REQUIRED"
        | "GUARANTEE_NOT_VERIFIED"
        | "GUARANTEE_EXPIRED"
        | "GUARANTEE_REVOKED"
        | "CREDIT_LIMIT_EXCEEDED"
        | "POLICY_LIMIT_EXCEEDED"
        | "DENIED"
        | "SYSTEM_EXCEPTION"
      payment_event_type:
        | "PAYMENT_CREATED"
        | "PAYMENT_RESERVED"
        | "PAYMENT_CALLBACK_RECEIVED"
        | "PAYMENT_CONFIRMED"
        | "PAYMENT_SETTLED"
        | "PAYMENT_FAILED"
        | "PAYMENT_REVERSED"
        | "PAYMENT_REFUNDED"
      payment_state:
        | "INITIATED"
        | "ACCEPTED"
        | "PROCESSING"
        | "CALLBACK_RECEIVED"
        | "COMPLETED"
        | "FAILED"
        | "CANCELLED"
        | "TIMED_OUT"
        | "REVERSED"
        | "RECONCILING"
        | "RECONCILED"
      reconciliation_case_status:
        | "OPEN"
        | "IN_PROGRESS"
        | "ESCALATED"
        | "RESOLVED"
        | "REVERSED"
        | "CLOSED"
      reconciliation_severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
      reconciliation_status: "OK" | "VARIANCE" | "PENDING_REVIEW" | "RESOLVED"
      reconciliation_status_enum:
        | "RECONCILED"
        | "MISMATCH"
        | "FRAUD_ALERT"
        | "ORPHAN"
        | "FAILED"
        | "PENDING_REVIEW"
      revenue_event_type:
        | "RIDE_COMPLETED"
        | "DELIVERY_COMPLETED"
        | "RENTAL_COMPLETED"
        | "REFUND"
        | "ADJUSTMENT"
      ride_payment_state:
        | "AWAITING_PAYMENT"
        | "PAYMENT_VERIFIED"
        | "CREDIT_AUTHORIZED"
        | "CREDIT_SETTLED"
        | "CANCELLED"
        | "FAILED"
      risk_entity_type:
        | "rider"
        | "driver"
        | "corporate"
        | "courier"
        | "device"
        | "ip"
        | "vehicle"
        | "payment_method"
      risk_event_severity: "low" | "medium" | "high" | "critical"
      risk_severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
      settlement_batch_status:
        | "OPEN"
        | "SUBMITTED"
        | "SETTLED"
        | "RECONCILED"
        | "FAILED"
        | "CLOSED"
      settlement_status:
        | "PENDING"
        | "MATCHED"
        | "MISMATCHED"
        | "MISSING"
        | "REVERSED"
      tax_audit_event:
        | "INSERT"
        | "UPDATE"
        | "STATUS_CHANGE"
        | "ADJUSTMENT"
        | "EXEMPTION_GRANTED"
        | "EXEMPTION_REVOKED"
        | "CALCULATION"
      tax_period_status: "OPEN" | "LOCKED" | "CLOSED" | "FILED"
      tax_reconciliation_status: "OK" | "VARIANCE" | "FAILED"
      tax_scheme_kind:
        | "VAT"
        | "REVERSE_CHARGE_VAT"
        | "WITHHOLDING"
        | "CORPORATE"
        | "DIGITAL_SERVICE"
        | "ZERO_RATED"
        | "EXEMPT"
      tax_submission_status:
        | "DRAFT"
        | "SUBMITTED"
        | "ACKNOWLEDGED"
        | "REJECTED"
        | "AMENDED"
      tender_state:
        | "DRAFT"
        | "OPEN"
        | "INVITED"
        | "RESPONSES_RECEIVED"
        | "EVALUATION"
        | "AWARDED"
        | "CANCELLED"
        | "EXPIRED"
      treasury_account_kind:
        | "BANK"
        | "MPESA_FLOAT"
        | "AIRTEL_FLOAT"
        | "ESCROW"
        | "RESERVE"
        | "SETTLEMENT"
        | "OPERATING"
      txn_direction: "credit" | "debit"
      txn_kind: "topup" | "payout" | "trip_charge" | "refund" | "adjustment"
      txn_status: "pending" | "completed" | "failed"
      wallet_type: "personal" | "driver" | "corporate"
      yalla_payment_mode: "CASH" | "CREDIT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "support",
        "rider",
        "driver",
        "corporate_admin",
        "corporate_employee",
        "finance_admin",
        "super_admin",
      ],
      approval_request_status: [
        "PENDING",
        "IN_REVIEW",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
        "ESCALATED",
      ],
      bank_guarantee_state: [
        "UPLOADED",
        "VALIDATING",
        "DOCUMENT_VERIFICATION",
        "BANK_VERIFICATION",
        "PENDING_APPROVAL",
        "APPROVED",
        "ACTIVE",
        "SUSPENDED",
        "EXPIRING",
        "EXPIRED",
        "REVOKED",
        "REJECTED",
      ],
      budget_reservation_status: [
        "RESERVED",
        "CONSUMED",
        "RELEASED",
        "EXPIRED",
      ],
      budget_status: ["DRAFT", "ACTIVE", "LOCKED", "CLOSED", "OVERSPENT"],
      capacity_availability_state: [
        "CONFIGURED",
        "AVAILABLE",
        "SUSPENDED",
        "EXPIRED",
        "CANCELLED",
      ],
      capacity_reservation_state: [
        "ACTIVE",
        "COMMITTED",
        "CONSUMED",
        "RELEASED",
        "EXPIRED",
        "CANCELLED",
      ],
      carrier_contract_status: [
        "NONE",
        "DRAFT",
        "SIGNED",
        "EXPIRED",
        "TERMINATED",
      ],
      carrier_operating_status: [
        "ONBOARDING",
        "ACTIVE",
        "SUSPENDED",
        "OFFBOARDED",
      ],
      carrier_quote_state: [
        "DRAFT",
        "SUBMITTED",
        "SUPERSEDED",
        "ACCEPTED",
        "REJECTED",
        "WITHDRAWN",
        "EXPIRED",
      ],
      corp_ledger_entry_type: [
        "top_up",
        "ride_charge",
        "refund",
        "adjustment",
        "reversal",
      ],
      corporate_invoice_status: [
        "DRAFT",
        "ISSUED",
        "PARTIALLY_PAID",
        "PAID",
        "OVERDUE",
        "VOIDED",
      ],
      corporate_period_status: [
        "OPEN",
        "LOCKED",
        "BILLED",
        "SETTLED",
        "CANCELLED",
      ],
      corporate_status: ["ACTIVE", "SUSPENDED", "CLOSED"],
      cost_center_status: ["ACTIVE", "FROZEN", "ARCHIVED"],
      credit_facility_state: [
        "DRAFT",
        "ACTIVE",
        "SUSPENDED",
        "EXPIRED",
        "CLOSED",
      ],
      credit_reservation_state: ["ACTIVE", "UTILIZED", "RELEASED", "EXPIRED"],
      dispute_reason: [
        "FRAUD",
        "DUPLICATE",
        "SERVICE_NOT_RENDERED",
        "OVERCHARGE",
        "UNAUTHORIZED",
        "OTHER",
      ],
      dispute_status: [
        "OPEN",
        "INVESTIGATING",
        "PENDING",
        "RESOLVED",
        "REJECTED",
        "ESCALATED",
      ],
      driver_etims_invoice_status: [
        "PENDING",
        "SUBMITTED",
        "ACCEPTED",
        "REJECTED",
        "RETRYING",
        "FAILED",
        "VOIDED",
        "REFUNDED",
      ],
      driver_payout_batch_status: [
        "OPEN",
        "LOCKED",
        "SUBMITTED",
        "SETTLED",
        "RECONCILED",
        "FAILED",
      ],
      driver_payout_method_type: ["MPESA", "BANK_TRANSFER", "CARD"],
      driver_payout_status: [
        "PENDING",
        "QUEUED",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "REVERSED",
        "CANCELLED",
      ],
      driver_tax_liability_status: [
        "OPEN",
        "PARTIAL",
        "PAID",
        "OVERDUE",
        "WAIVED",
      ],
      driver_tax_profile_status: [
        "PENDING",
        "ACTIVE",
        "SUSPENDED",
        "DEREGISTERED",
      ],
      driver_tax_regime: ["TOT", "INCOME_TAX", "PAYE", "EXEMPT"],
      driver_tax_return_status: [
        "DRAFT",
        "FILED",
        "ACCEPTED",
        "REJECTED",
        "AMENDED",
      ],
      driver_type: ["individual", "fleet_driver", "corporate_driver"],
      etims_invoice_status: [
        "PENDING",
        "SYNCING",
        "RETRYING",
        "SYNCED",
        "FAILED",
        "VOIDED",
        "REFUNDED",
      ],
      etims_invoice_type: ["SALE", "CREDIT_NOTE", "DEBIT_NOTE", "REFUND"],
      fin_ledger_entry_kind: [
        "BOOKING",
        "PAYMENT",
        "RECEIVABLE",
        "CREDIT_UTILISATION",
        "RECONCILIATION",
        "ADJUSTMENT",
      ],
      fraud_review_status: [
        "open",
        "reviewing",
        "confirmed",
        "dismissed",
        "escalated",
      ],
      freight_alloc_state: [
        "ALLOCATED",
        "PARTIAL",
        "OVERPAYMENT",
        "UNDERPAYMENT",
        "UNMATCHED",
        "REVERSED",
        "DUPLICATE",
      ],
      freight_booking_state: [
        "CREATED",
        "CARRIER_ASSIGNED",
        "RESOURCED",
        "DISPATCHED",
        "EXECUTING",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ],
      freight_charge_party: ["CUSTOMER", "CARRIER"],
      freight_charge_status: [
        "CALCULATED",
        "PENDING_REVIEW",
        "APPROVED",
        "INVOICED",
        "PAID",
        "SETTLED",
        "VOID",
      ],
      freight_invoice_status: [
        "DRAFT",
        "ISSUED",
        "PARTIALLY_PAID",
        "PAID",
        "VOID",
      ],
      freight_pricing_basis: [
        "PER_SHIPMENT",
        "PER_PACKAGE",
        "PER_KG",
        "PER_KM",
        "PER_TRIP",
        "PER_LOAD",
        "PER_PALLET",
        "PER_CONTAINER",
        "CONTRACT_RATE",
      ],
      freight_quote_status: [
        "DRAFT",
        "ISSUED",
        "ACCEPTED",
        "EXPIRED",
        "SUPERSEDED",
        "WITHDRAWN",
        "REJECTED",
      ],
      freight_requirement_state: [
        "DRAFT",
        "SUBMITTED",
        "SOURCING",
        "AWARDED",
        "BOOKED",
        "FULFILLED",
        "CANCELLED",
      ],
      freight_settlement_status: [
        "CALCULATED",
        "PENDING_REVIEW",
        "APPROVED",
        "PAID",
        "REVERSED",
      ],
      fx_rate_type: ["SPOT", "DAILY", "HISTORICAL", "CLOSING"],
      journal_source: [
        "MPESA_SETTLEMENT",
        "MPESA_REVERSAL",
        "DRIVER_PAYOUT",
        "CORPORATE_TRANSFER",
        "RIDE_COMPLETION",
        "MANUAL_ADJUSTMENT",
        "FX_REVALUATION",
        "SETTLEMENT_BATCH",
        "OTHER",
      ],
      journal_status: ["DRAFT", "POSTED", "REVERSED"],
      ledger_account_kind: [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
        "CLEARING",
        "WALLET",
      ],
      ledger_direction: ["DEBIT", "CREDIT"],
      mobility_order_status: [
        "DRAFT",
        "QUOTE_REQUESTED",
        "QUOTED",
        "CUSTOMER_APPROVAL",
        "PAYMENT_PENDING",
        "CONFIRMED",
        "ALLOCATING",
        "ASSIGNED",
        "EN_ROUTE",
        "IN_SERVICE",
        "COMPLETED",
        "RECONCILING",
        "SETTLED",
        "CANCELLED",
        "FAILED",
        "REASSIGNMENT_REQUIRED",
        "SUPPLIER_NO_SHOW",
        "CUSTOMER_NO_SHOW",
        "DISPUTED",
        "REFUNDED",
      ],
      mobility_service_type: [
        "RIDE",
        "CHARTER",
        "DELIVERY",
        "LOGISTICS",
        "AIR_CHARTER",
        "MARINE",
        "RENTAL",
        "LEASING",
        "MULTI_SERVICE",
      ],
      mpesa_status: ["pending", "success", "failed"],
      partner_commercial_model: [
        "REFER",
        "BOOK",
        "EMBED",
        "API",
        "WHITE_LABEL",
        "ORCHESTRATE",
      ],
      partner_commission_model: [
        "NET_RATE",
        "MARKUP",
        "COMMISSION",
        "REVENUE_SHARE",
        "FIXED_FEE",
        "TIERED_RATE",
        "CONTRACT_RATE",
        "CUSTOM",
      ],
      partner_ledger_kind: [
        "wallet_topup",
        "order_hold",
        "order_capture",
        "order_release",
        "partner_margin",
        "yalla_margin",
        "tax",
        "supplier_cost",
        "settlement_payout",
        "adjustment",
        "reversal",
      ],
      partner_onboarding_stage: [
        "applied",
        "screening",
        "documents_pending",
        "documents_review",
        "contracting",
        "activation",
        "verified",
        "rejected",
        "suspended",
      ],
      partner_settlement_state: [
        "open",
        "pending_review",
        "approved",
        "paid",
        "reconciled",
        "disputed",
      ],
      partner_status: ["draft", "pending", "active", "suspended", "terminated"],
      partner_type: [
        "TOUR_OPERATOR",
        "DMC",
        "TRAVEL_AGENCY",
        "HOTEL",
        "AIRLINE",
        "AIR_CHARTER",
        "CORPORATE",
        "EVENT",
        "ECOMMERCE",
        "RETAIL",
        "COURIER",
        "LOGISTICS",
        "NGO",
        "SCHOOL",
        "GOVERNMENT",
        "TRAVEL_PLATFORM",
        "OTHER",
      ],
      partner_verification_status: [
        "unverified",
        "in_review",
        "verified",
        "rejected",
        "expired",
      ],
      payment_audit_event: [
        "INSERT",
        "UPDATE",
        "STATUS_CHANGE",
        "REVERSAL",
        "RECONCILIATION",
        "EXPORT",
        "DELETE_REQUEST",
        "SOFT_DELETE",
      ],
      payment_decision_type: [
        "ALLOW_CASH_PAYMENT",
        "ALLOW_GUARANTEED_CREDIT",
        "PAYMENT_REQUIRED",
        "APPROVAL_REQUIRED",
        "CREDIT_UNAVAILABLE",
        "GUARANTEE_REQUIRED",
        "GUARANTEE_NOT_VERIFIED",
        "GUARANTEE_EXPIRED",
        "GUARANTEE_REVOKED",
        "CREDIT_LIMIT_EXCEEDED",
        "POLICY_LIMIT_EXCEEDED",
        "DENIED",
        "SYSTEM_EXCEPTION",
      ],
      payment_event_type: [
        "PAYMENT_CREATED",
        "PAYMENT_RESERVED",
        "PAYMENT_CALLBACK_RECEIVED",
        "PAYMENT_CONFIRMED",
        "PAYMENT_SETTLED",
        "PAYMENT_FAILED",
        "PAYMENT_REVERSED",
        "PAYMENT_REFUNDED",
      ],
      payment_state: [
        "INITIATED",
        "ACCEPTED",
        "PROCESSING",
        "CALLBACK_RECEIVED",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "REVERSED",
        "RECONCILING",
        "RECONCILED",
      ],
      reconciliation_case_status: [
        "OPEN",
        "IN_PROGRESS",
        "ESCALATED",
        "RESOLVED",
        "REVERSED",
        "CLOSED",
      ],
      reconciliation_severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      reconciliation_status: ["OK", "VARIANCE", "PENDING_REVIEW", "RESOLVED"],
      reconciliation_status_enum: [
        "RECONCILED",
        "MISMATCH",
        "FRAUD_ALERT",
        "ORPHAN",
        "FAILED",
        "PENDING_REVIEW",
      ],
      revenue_event_type: [
        "RIDE_COMPLETED",
        "DELIVERY_COMPLETED",
        "RENTAL_COMPLETED",
        "REFUND",
        "ADJUSTMENT",
      ],
      ride_payment_state: [
        "AWAITING_PAYMENT",
        "PAYMENT_VERIFIED",
        "CREDIT_AUTHORIZED",
        "CREDIT_SETTLED",
        "CANCELLED",
        "FAILED",
      ],
      risk_entity_type: [
        "rider",
        "driver",
        "corporate",
        "courier",
        "device",
        "ip",
        "vehicle",
        "payment_method",
      ],
      risk_event_severity: ["low", "medium", "high", "critical"],
      risk_severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      settlement_batch_status: [
        "OPEN",
        "SUBMITTED",
        "SETTLED",
        "RECONCILED",
        "FAILED",
        "CLOSED",
      ],
      settlement_status: [
        "PENDING",
        "MATCHED",
        "MISMATCHED",
        "MISSING",
        "REVERSED",
      ],
      tax_audit_event: [
        "INSERT",
        "UPDATE",
        "STATUS_CHANGE",
        "ADJUSTMENT",
        "EXEMPTION_GRANTED",
        "EXEMPTION_REVOKED",
        "CALCULATION",
      ],
      tax_period_status: ["OPEN", "LOCKED", "CLOSED", "FILED"],
      tax_reconciliation_status: ["OK", "VARIANCE", "FAILED"],
      tax_scheme_kind: [
        "VAT",
        "REVERSE_CHARGE_VAT",
        "WITHHOLDING",
        "CORPORATE",
        "DIGITAL_SERVICE",
        "ZERO_RATED",
        "EXEMPT",
      ],
      tax_submission_status: [
        "DRAFT",
        "SUBMITTED",
        "ACKNOWLEDGED",
        "REJECTED",
        "AMENDED",
      ],
      tender_state: [
        "DRAFT",
        "OPEN",
        "INVITED",
        "RESPONSES_RECEIVED",
        "EVALUATION",
        "AWARDED",
        "CANCELLED",
        "EXPIRED",
      ],
      treasury_account_kind: [
        "BANK",
        "MPESA_FLOAT",
        "AIRTEL_FLOAT",
        "ESCROW",
        "RESERVE",
        "SETTLEMENT",
        "OPERATING",
      ],
      txn_direction: ["credit", "debit"],
      txn_kind: ["topup", "payout", "trip_charge", "refund", "adjustment"],
      txn_status: ["pending", "completed", "failed"],
      wallet_type: ["personal", "driver", "corporate"],
      yalla_payment_mode: ["CASH", "CREDIT"],
    },
  },
} as const
