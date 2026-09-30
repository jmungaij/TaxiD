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
      mpesa_status: "pending" | "success" | "failed"
      txn_direction: "credit" | "debit"
      txn_kind: "topup" | "payout" | "trip_charge" | "refund" | "adjustment"
      txn_status: "pending" | "completed" | "failed"
      wallet_type: "personal" | "driver" | "corporate"
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
      mpesa_status: ["pending", "success", "failed"],
      txn_direction: ["credit", "debit"],
      txn_kind: ["topup", "payout", "trip_charge", "refund", "adjustment"],
      txn_status: ["pending", "completed", "failed"],
      wallet_type: ["personal", "driver", "corporate"],
    },
  },
} as const
