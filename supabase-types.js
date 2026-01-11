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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          actor: string
          created_at: string
          details: Json | null
          id: number
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          details?: Json | null
          id?: number
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          details?: Json | null
          id?: number
        }
        Relationships: []
      }
      bridge_status: {
        Row: {
          device_id: string
          last_seen: string | null
          last_uid: string | null
        }
        Insert: {
          device_id: string
          last_seen?: string | null
          last_uid?: string | null
        }
        Update: {
          device_id?: string
          last_seen?: string | null
          last_uid?: string | null
        }
        Relationships: []
      }
      cards: {
        Row: {
          active: boolean | null
          card_role: string
          card_token: string | null
          card_uid: string | null
          id: number
          student_id: number | null
          team_id: number | null
        }
        Insert: {
          active?: boolean | null
          card_role?: string
          card_token?: string | null
          card_uid?: string | null
          id?: number
          student_id?: number | null
          team_id?: number | null
        }
        Update: {
          active?: boolean | null
          card_role?: string
          card_token?: string | null
          card_uid?: string | null
          id?: number
          student_id?: number | null
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      game_scores: {
        Row: {
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_scores_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: []
      }
      game_scores_orbit: {
        Row: {
          created_at: string | null
          difficulty: string | null
          id: number
          local_team_id: number | null
          local_team_name: string | null
          score: number | null
          student_id: number | null
          student_name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          difficulty?: string | null
          id?: number
          local_team_id?: number | null
          local_team_name?: string | null
          score?: number | null
          student_id?: number | null
          student_name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          difficulty?: string | null
          id?: number
          local_team_id?: number | null
          local_team_name?: string | null
          score?: number | null
          student_id?: number | null
          student_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_orbit_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_orbit_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_orbit_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_orbit_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_orbit_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_scores_road: {
        Row: {
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_road_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_road_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_road_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_road_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_road_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_scores_road_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: []
      }
      game_scores_snake: {
        Row: {
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_snake_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_snake_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_snake_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_snake_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_snake_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_scores_snake_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: []
      }
      game_scores_tetris: {
        Row: {
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_tetris_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_tetris_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_tetris_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_tetris_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_tetris_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_scores_tetris_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string
          difficulty: string
          id: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty: string
          id?: number
          local_team_id: number
          local_team_name: string
          score: number
          student_id: number
          student_name: string
          user_id: string
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          difficulty?: string
          id?: number
          local_team_id?: number
          local_team_name?: string
          score?: number
          student_id?: number
          student_name?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          id: string
          role: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          auth_user_id: string | null
          class: string | null
          id: number
          name: string
        }
        Insert: {
          auth_user_id?: string | null
          class?: string | null
          id?: number
          name: string
        }
        Update: {
          auth_user_id?: string | null
          class?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          id: number
          student_id: number
          team_id: number
        }
        Insert: {
          id?: number
          student_id: number
          team_id: number
        }
        Update: {
          id?: number
          student_id?: number
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pool_tx: {
        Row: {
          created_at: string
          delta: number
          device_id: string | null
          id: number
          local_team_id: number | null
          pool_team_id: number
          reason: string | null
          teacher_id: string | null
          tx_type: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          device_id?: string | null
          id?: number
          local_team_id?: number | null
          pool_team_id: number
          reason?: string | null
          teacher_id?: string | null
          tx_type?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          device_id?: string | null
          id?: number
          local_team_id?: number | null
          pool_team_id?: number
          reason?: string | null
          teacher_id?: string | null
          tx_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pool_tx_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string
          delta: number
          device_id: string | null
          id: number
          local_team_id: number | null
          pool_team_id: number
          reason: string | null
          teacher_id: string | null
          tx_type: string | null
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          delta: number
          device_id?: string | null
          id?: number
          local_team_id?: number | null
          pool_team_id: number
          reason?: string | null
          teacher_id?: string | null
          tx_type?: string | null
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string
          delta?: number
          device_id?: string | null
          id?: number
          local_team_id?: number | null
          pool_team_id?: number
          reason?: string | null
          teacher_id?: string | null
          tx_type?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          class: string | null
          id: number
          name: string
          parent_global_id: number | null
          scope: string | null
        }
        Insert: {
          class?: string | null
          id?: number
          name: string
          parent_global_id?: number | null
          scope?: string | null
        }
        Update: {
          class?: string | null
          id?: number
          name?: string
          parent_global_id?: number | null
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_global_id_fkey"
            columns: ["parent_global_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "teams_parent_global_id_fkey"
            columns: ["parent_global_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "teams_parent_global_id_fkey"
            columns: ["parent_global_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          created_at: string | null
          delta: number
          device_id: string | null
          id: number
          reason: string | null
          student_id: number | null
          teacher_id: string | null
        }
        Insert: {
          created_at?: string | null
          delta: number
          device_id?: string | null
          id?: number
          reason?: string | null
          student_id?: number | null
          teacher_id?: string | null
        }
        Update: {
          created_at?: string | null
          delta?: number
          device_id?: string | null
          id?: number
          reason?: string | null
          student_id?: number | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      transactions_archive: {
        Row: {
          actor: string | null
          archived_at: string
          created_at: string | null
          delta: number
          device_id: string | null
          id: number
          reason: string | null
          student_id: number | null
          teacher_id: string | null
        }
        Insert: {
          actor?: string | null
          archived_at?: string
          created_at?: string | null
          delta: number
          device_id?: string | null
          id?: number
          reason?: string | null
          student_id?: number | null
          teacher_id?: string | null
        }
        Update: {
          actor?: string | null
          archived_at?: string
          created_at?: string | null
          delta?: number
          device_id?: string | null
          id?: number
          reason?: string | null
          student_id?: number | null
          teacher_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      balances: {
        Row: {
          points: number | null
          student_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      game_local_best: {
        Row: {
          best_score: number | null
          local_team_id: number | null
          student_id: number | null
          student_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "game_scores_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "team_member_points"
            referencedColumns: ["student_id"]
          },
        ]
      }
      team_balances: {
        Row: {
          points: number | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_local_remaining: {
        Row: {
          local_team_id: number | null
          pool_points: number | null
          pool_remaining: number | null
          pool_team_id: number | null
          spent_by_local: number | null
        }
        Relationships: []
      }
      team_local_spend: {
        Row: {
          local_team_id: number | null
          spent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_local_team_id_fkey"
            columns: ["local_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_points: {
        Row: {
          class: string | null
          name: string | null
          points: number | null
          student_id: number | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pool_balances: {
        Row: {
          points: number | null
          pool_team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pool_earned: {
        Row: {
          earned: number | null
          pool_team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["local_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "team_local_remaining"
            referencedColumns: ["pool_team_id"]
          },
          {
            foreignKeyName: "team_pool_tx_pool_team_id_fkey"
            columns: ["pool_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      award_points: {
        Args: {
          _delta: number
          _device_id: string
          _identifier: string
          _reason: string
        }
        Returns: Json
      }
      award_points_by_student: {
        Args: {
          _delta: number
          _device_id: string
          _reason: string
          _student_id: number
        }
        Returns: Json
      }
      delete_student: { Args: { _student_id: number }; Returns: undefined }
      game_local_team_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          best_student_name: string
          local_team_id: number
          local_team_name: string
          pool_team_id: number
          pool_team_name: string
          team_best: number
        }[]
      }
      game_local_team_leaderboard_road: {
        Args: { _limit?: number }
        Returns: {
          best_student_name: string
          local_team_id: number
          local_team_name: string
          pool_team_id: number
          pool_team_name: string
          team_best: number
        }[]
      }
      game_local_team_leaderboard_snake: {
        Args: { _limit?: number }
        Returns: {
          best_student_name: string
          local_team_id: number
          local_team_name: string
          pool_team_id: number
          pool_team_name: string
          team_best: number
        }[]
      }
      game_local_team_leaderboard_tetris: {
        Args: { _limit?: number }
        Returns: {
          best_student_name: string
          local_team_id: number
          local_team_name: string
          pool_team_id: number
          pool_team_name: string
          team_best: number
        }[]
      }
      get_my_local_total: {
        Args: never
        Returns: {
          local_team_id: number
          pool_points: number
          pool_team_id: number
          spent: number
          total_local: number
        }[]
      }
      reset_all_points: {
        Args: { include_game_scores?: boolean }
        Returns: Json
      }
      reset_game_scores: { Args: { games?: string[] }; Returns: Json }
      student_can_read_team: {
        Args: { _team_id: number; _uid: string }
        Returns: boolean
      }
      team_local_spend_adjust: {
        Args: {
          _amount: number
          _device_id?: string
          _local_team_id: number
          _reason?: string
        }
        Returns: Json
      }
      team_pool_adjust: {
        Args: {
          _delta: number
          _device_id?: string
          _pool_team_id: number
          _reason?: string
        }
        Returns: Json
      }
      top_local_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          local_name: string
          local_team_id: number
          pool_name: string
          pool_points: number
          pool_team_id: number
          spent: number
          total_local: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
