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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      note_templates: {
        Row: {
          id: string
          clinic_id: string
          field: string
          title: string
          body: string
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          clinic_id: string
          field?: string
          title: string
          body?: string
        }
        Update: {
          field?: string
          title?: string
          body?: string
          archived_at?: string | null
        }
        Relationships: []
      }
      access_requests: {
        Row: {
          clinic_id: string
          id: string
          requested_at: string
          requested_email: string
          requested_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          id?: string
          requested_at?: string
          requested_email?: string
          requested_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          id?: string
          requested_at?: string
          requested_email?: string
          requested_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_memberships: {
        Row: {
          clinic_id: string
          created_at: string
          role: Database["public"]["Enums"]["clinic_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          role?: Database["public"]["Enums"]["clinic_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["clinic_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_memberships_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          clinic_id: string
          created_at: string
          schedule_horizon_days: number
          schedule_min_notice_hours: number
          schedule_slot_minutes: number
          appointment_reminder_enabled: boolean
          whatsapp_autoreply_enabled: boolean
          whatsapp_autoreply_known_text: string
          whatsapp_menu_info_text: string
          whatsapp_autoreply_text: string
          appointment_reminder_days: number
          whatsapp_reminder_template_name: string
          whatsapp_reopen_template_name: string
          template_d30: string
          template_m90: string
          updated_at: string
          whatsapp_phone_number_id: string | null
          whatsapp_template_language: string
          whatsapp_template_name: string
          whatsapp_waba_id: string | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          schedule_horizon_days?: number
          schedule_min_notice_hours?: number
          schedule_slot_minutes?: number
          appointment_reminder_enabled?: boolean
          whatsapp_autoreply_enabled?: boolean
          whatsapp_autoreply_known_text?: string
          whatsapp_menu_info_text?: string
          whatsapp_autoreply_text?: string
          appointment_reminder_days?: number
          whatsapp_reminder_template_name?: string
          whatsapp_reopen_template_name?: string
          template_d30?: string
          template_m90?: string
          updated_at?: string
          whatsapp_phone_number_id?: string | null
          whatsapp_template_language?: string
          whatsapp_template_name?: string
          whatsapp_waba_id?: string | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          schedule_horizon_days?: number
          schedule_min_notice_hours?: number
          schedule_slot_minutes?: number
          appointment_reminder_enabled?: boolean
          whatsapp_autoreply_enabled?: boolean
          whatsapp_autoreply_known_text?: string
          whatsapp_menu_info_text?: string
          whatsapp_autoreply_text?: string
          appointment_reminder_days?: number
          whatsapp_reminder_template_name?: string
          whatsapp_reopen_template_name?: string
          template_d30?: string
          template_m90?: string
          updated_at?: string
          whatsapp_phone_number_id?: string | null
          whatsapp_template_language?: string
          whatsapp_template_name?: string
          whatsapp_waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_settings_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
          allergies: string
          archived_at: string | null
          assessment: string
          chief_complaint: string
          cid: string
          clinic_id: string
          clinical_history: string
          consultation_date: string
          created_at: string
          created_by: string | null
          current_medications: string
          encounter_type: string
          family_history: string
          height_cm: number | null
          id: string
          notes: string
          patient_id: string
          personal_history: string
          physical_exam: string
          plan: string
          prescription: string
          return_plan: string
          unit: string
          updated_at: string
          updated_by: string | null
          weight_kg: number | null
        }
        Insert: {
          allergies?: string
          archived_at?: string | null
          assessment?: string
          chief_complaint?: string
          cid?: string
          clinic_id: string
          clinical_history?: string
          consultation_date: string
          created_at?: string
          created_by?: string | null
          current_medications?: string
          encounter_type?: string
          family_history?: string
          height_cm?: number | null
          id?: string
          notes?: string
          patient_id: string
          personal_history?: string
          physical_exam?: string
          plan?: string
          prescription?: string
          return_plan?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Update: {
          allergies?: string
          archived_at?: string | null
          assessment?: string
          chief_complaint?: string
          cid?: string
          clinic_id?: string
          clinical_history?: string
          consultation_date?: string
          created_at?: string
          created_by?: string | null
          current_medications?: string
          encounter_type?: string
          family_history?: string
          height_cm?: number | null
          id?: string
          notes?: string
          patient_id?: string
          personal_history?: string
          physical_exam?: string
          plan?: string
          prescription?: string
          return_plan?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultations_patient_clinic_fk"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      followups: {
        Row: {
          archived_at: string | null
          clinic_id: string
          completed_at: string | null
          consultation_id: string
          created_at: string
          created_by: string | null
          due_date: string
          followup_key: Database["public"]["Enums"]["followup_key"]
          id: string
          opened_at: string | null
          patient_id: string
          status: Database["public"]["Enums"]["followup_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          clinic_id: string
          completed_at?: string | null
          consultation_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          followup_key: Database["public"]["Enums"]["followup_key"]
          id?: string
          opened_at?: string | null
          patient_id: string
          status?: Database["public"]["Enums"]["followup_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          clinic_id?: string
          completed_at?: string | null
          consultation_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          followup_key?: Database["public"]["Enums"]["followup_key"]
          id?: string
          opened_at?: string | null
          patient_id?: string
          status?: Database["public"]["Enums"]["followup_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followups_consultation_patient_clinic_fk"
            columns: ["consultation_id", "patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id", "patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "followups_patient_clinic_fk"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      patients: {
        Row: {
          archived_at: string | null
          birth_date: string | null
          cid: string
          city: string
          clinic_id: string
          consultation_date: string
          created_at: string
          created_by: string | null
          guardian_name: string
          id: string
          insurance: string
          name: string
          neighborhood: string
          notes: string
          phone: string
          sex: Database["public"]["Enums"]["patient_sex"]
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          birth_date?: string | null
          cid?: string
          city?: string
          clinic_id: string
          consultation_date: string
          created_at?: string
          created_by?: string | null
          guardian_name?: string
          id?: string
          insurance?: string
          name: string
          neighborhood?: string
          notes?: string
          phone?: string
          sex?: Database["public"]["Enums"]["patient_sex"]
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          birth_date?: string | null
          cid?: string
          city?: string
          clinic_id?: string
          consultation_date?: string
          created_at?: string
          created_by?: string | null
          guardian_name?: string
          id?: string
          insurance?: string
          name?: string
          neighborhood?: string
          notes?: string
          phone?: string
          sex?: Database["public"]["Enums"]["patient_sex"]
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinic_units: {
        Row: {
          address: string
          archived_at: string | null
          clinic_id: string
          cnes: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          address?: string
          archived_at?: string | null
          clinic_id: string
          cnes?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          address?: string
          archived_at?: string | null
          clinic_id?: string
          cnes?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      availability_rules: {
        Row: {
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          starts_at: string
          unit_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          starts_at: string
          unit_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          starts_at?: string
          unit_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      schedule_exceptions: {
        Row: {
          clinic_id: string
          created_at: string
          ends_at: string | null
          exception_date: string
          id: string
          is_closed: boolean
          reason: string
          starts_at: string | null
          unit_id: string | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          ends_at?: string | null
          exception_date: string
          id?: string
          is_closed?: boolean
          reason?: string
          starts_at?: string | null
          unit_id?: string | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          ends_at?: string | null
          exception_date?: string
          id?: string
          is_closed?: boolean
          reason?: string
          starts_at?: string | null
          unit_id?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          cancelled_at: string | null
          confirmed_at: string | null
          contact_name: string
          contact_phone: string
          confirmed_by_clinic: boolean
          hold_expires_at: string | null
          reminder_sent_at: string | null
          reschedule_count: number
          rescheduled_from: string | null
          reminder_failed_at: string | null
          reminder_failure_reason: string | null
          reschedule_requested_at: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          patient_id: string | null
          patient_note: string
          source: Database["public"]["Enums"]["appointment_source"]
          staff_note: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          unit_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          contact_name?: string
          contact_phone?: string
          confirmed_by_clinic?: boolean
          hold_expires_at?: string | null
          reminder_sent_at?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          reminder_failed_at?: string | null
          reminder_failure_reason?: string | null
          reschedule_requested_at?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          patient_id?: string | null
          patient_note?: string
          source?: Database["public"]["Enums"]["appointment_source"]
          staff_note?: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          unit_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          contact_name?: string
          contact_phone?: string
          confirmed_by_clinic?: boolean
          hold_expires_at?: string | null
          reminder_sent_at?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          reminder_failed_at?: string | null
          reminder_failure_reason?: string | null
          reschedule_requested_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          patient_id?: string | null
          patient_note?: string
          source?: Database["public"]["Enums"]["appointment_source"]
          staff_note?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          unit_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          clinic_id: string
          created_at: string
          display_phone: string
          id: string
          last_message_at: string | null
          needs_attention: boolean
          autoreply_sent_at: string | null
          booking_state: string | null
          booking_options: Json | null
          booking_unit_id: string | null
          booking_patient_id: string | null
          booking_replaces_id: string | null
          booking_updated_at: string | null
          menu_sent_at: string | null
          profile_name: string
          attention_reason: string | null
          patient_id: string | null
          status: string
          unread_count: number
          updated_at: string
          wa_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          display_phone?: string
          id?: string
          last_message_at?: string | null
          needs_attention?: boolean
          autoreply_sent_at?: string | null
          booking_state?: string | null
          booking_options?: Json | null
          booking_unit_id?: string | null
          booking_patient_id?: string | null
          booking_replaces_id?: string | null
          booking_updated_at?: string | null
          menu_sent_at?: string | null
          profile_name?: string
          attention_reason?: string | null
          patient_id?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
          wa_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          display_phone?: string
          id?: string
          last_message_at?: string | null
          needs_attention?: boolean
          autoreply_sent_at?: string | null
          booking_state?: string | null
          booking_options?: Json | null
          booking_unit_id?: string | null
          booking_patient_id?: string | null
          booking_replaces_id?: string | null
          booking_updated_at?: string | null
          menu_sent_at?: string | null
          profile_name?: string
          attention_reason?: string | null
          patient_id?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
          wa_id?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          automatic: boolean
          body: string
          clinic_id: string
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          external_message_id: string | null
          failed_at: string | null
          failure_reason: string | null
          followup_id: string | null
          appointment_id: string | null
          id: string
          message_type: string
          patient_id: string | null
          read_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name: string | null
        }
        Insert: {
          automatic?: boolean
          body?: string
          clinic_id: string
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          external_message_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          followup_id?: string | null
          appointment_id?: string | null
          id?: string
          message_type?: string
          patient_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name?: string | null
        }
        Update: {
          automatic?: boolean
          body?: string
          clinic_id?: string
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["whatsapp_message_direction"]
          external_message_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          followup_id?: string | null
          appointment_id?: string | null
          id?: string
          message_type?: string
          patient_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      /**
       * Indicadores do atendimento por WhatsApp num periodo (21/09/2026).
       * Devolve um objeto; o formato fica em NumerosDoWhatsApp, no repositorio.
       */
      numeros_do_whatsapp: {
        Args: { p_clinic: string; p_de: string; p_ate: string }
        Returns: Record<string, unknown>
      }
      conferir_integridade_prontuario: {
        Args: { p_clinic_id: string }
        Returns: {
          total: number
          registros_encadeados: number
          selo: string | null
          quebrado_no_id: number | null
          quebrado_em: string | null
        }[]
      }
      approve_access_request: {
        Args: {
          assigned_role?: Database["public"]["Enums"]["clinic_role"]
          request_id: string
        }
        Returns: undefined
      }
      bootstrap_current_user_clinic: {
        Args: { clinic_name: string }
        Returns: string
      }
      reject_access_request: {
        Args: { request_id: string }
        Returns: undefined
      }
      available_slots: {
        Args: { p_unit_id: string }
        Returns: { slot_start: string; slot_end: string }[]
      }
      vincular_contato_ao_paciente: {
        Args: { p_patient_id: string }
        Returns: { conversas: number; mensagens: number; consultas: number }[]
      }
    }
    Enums: {
      appointment_source: "clinic" | "whatsapp"
      appointment_status: "scheduled" | "attended" | "cancelled" | "no_show"
      clinic_role: "owner" | "clinician" | "staff" | "viewer"
      followup_key: "d15" | "d30" | "m90"
      followup_status: "pending" | "opened" | "completed"
      membership_status: "active" | "suspended"
      patient_sex: "F" | "M" | "O"
      whatsapp_message_direction: "inbound" | "outbound"
      whatsapp_message_status:
        | "queued"
        | "accepted"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      clinic_role: ["owner", "clinician", "staff", "viewer"],
      followup_key: ["d15", "d30", "m90"],
      followup_status: ["pending", "opened", "completed"],
      membership_status: ["active", "suspended"],
      patient_sex: ["F", "M", "O"],
    },
  },
} as const

