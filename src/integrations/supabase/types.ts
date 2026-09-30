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
