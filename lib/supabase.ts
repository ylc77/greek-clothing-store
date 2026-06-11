import { createClient } from "@supabase/supabase-js";
import type { Product, ProductFormData } from "./types";

type Database = {
  public: {
    Tables: {
      products: {
        Row: Product;
        Insert: Partial<Pick<Product, "id" | "created_at">> &
          Omit<ProductFormData, "price" | "stock"> & {
            price: number;
            stock: number;
          };
        Update: Partial<
          Omit<ProductFormData, "price" | "stock"> & {
            price: number;
            stock: number;
          }
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function getSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
