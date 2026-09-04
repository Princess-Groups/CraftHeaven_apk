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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          meta: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      addresses: {
        Row: {
          city: string
          created_at: string
          full_name: string
          id: string
          is_default: boolean
          line1: string
          line2: string | null
          phone: string
          pincode: string
          state: string
          user_id: string
        }
        Insert: {
          city: string
          created_at?: string
          full_name: string
          id?: string
          is_default?: boolean
          line1: string
          line2?: string | null
          phone: string
          pincode: string
          state: string
          user_id: string
        }
        Update: {
          city?: string
          created_at?: string
          full_name?: string
          id?: string
          is_default?: boolean
          line1?: string
          line2?: string | null
          phone?: string
          pincode?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          kind: string
          meta: Json | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind: string
          meta?: Json | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind?: string
          meta?: Json | null
          title?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      carts: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          unit: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          unit?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          unit?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          cgst_amount: number
          cgst_rate: number
          id: string
          igst_amount: number
          igst_rate: number
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sgst_amount: number
          sgst_rate: number
          unit: string
          unit_price: number
          variation: string | null
        }
        Insert: {
          cgst_amount?: number
          cgst_rate?: number
          id?: string
          igst_amount?: number
          igst_rate?: number
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sgst_amount?: number
          sgst_rate?: number
          unit?: string
          unit_price: number
          variation?: string | null
        }
        Update: {
          cgst_amount?: number
          cgst_rate?: number
          id?: string
          igst_amount?: number
          igst_rate?: number
          line_total?: number
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          sgst_amount?: number
          sgst_rate?: number
          unit?: string
          unit_price?: number
          variation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string | null
          address_snapshot: Json | null
          cgst_amount: number
          channel: Database["public"]["Enums"]["order_channel"]
          created_at: string
          created_by: string | null
          delivery_fee: number
          delivery_type: Database["public"]["Enums"]["delivery_type"] | null
          discount: number
          gst_total: number
          id: string
          igst_amount: number
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          sgst_amount: number
          shipping_charges: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax_type: string
          total: number
          transaction_state: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_id?: string | null
          address_snapshot?: Json | null
          cgst_amount?: number
          channel: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          created_by?: string | null
          delivery_fee?: number
          delivery_type?: Database["public"]["Enums"]["delivery_type"] | null
          discount?: number
          gst_total?: number
          id?: string
          igst_amount?: number
          notes?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          sgst_amount?: number
          shipping_charges?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax_type?: string
          total?: number
          transaction_state?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_id?: string | null
          address_snapshot?: Json | null
          cgst_amount?: number
          channel?: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          created_by?: string | null
          delivery_fee?: number
          delivery_type?: Database["public"]["Enums"]["delivery_type"] | null
          discount?: number
          gst_total?: number
          id?: string
          igst_amount?: number
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          sgst_amount?: number
          shipping_charges?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax_type?: string
          total?: number
          transaction_state?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand_id: string | null
          category_id: string | null
          cgst_rate: number
          color: string | null
          color_variations: Json
          created_at: string
          description: string | null
          discount_price: number | null
          gst_rate: number
          hsn_code: string | null
          id: string
          igst_rate: number
          image_urls: string[]
          is_available: boolean
          is_new: boolean
          is_trending: boolean
          low_stock_threshold: number
          name: string
          price: number
          purchase_price: number | null
          rating: number | null
          reorder_level: number
          sgst_rate: number
          sku: string | null
          size: string | null
          slug: string
          stock: number
          unit: string
        }
        Insert: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          cgst_rate?: number
          color?: string | null
          color_variations?: Json
          created_at?: string
          description?: string | null
          discount_price?: number | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          igst_rate?: number
          image_urls?: string[]
          is_available?: boolean
          is_new?: boolean
          is_trending?: boolean
          low_stock_threshold?: number
          name: string
          price: number
          purchase_price?: number | null
          rating?: number | null
          reorder_level?: number
          sgst_rate?: number
          sku?: string | null
          size?: string | null
          slug: string
          stock?: number
          unit?: string
        }
        Update: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          cgst_rate?: number
          color?: string | null
          color_variations?: Json
          created_at?: string
          description?: string | null
          discount_price?: number | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          igst_rate?: number
          image_urls?: string[]
          is_available?: boolean
          is_new?: boolean
          is_trending?: boolean
          low_stock_threshold?: number
          name?: string
          price?: number
          purchase_price?: number | null
          rating?: number | null
          reorder_level?: number
          sgst_rate?: number
          sku?: string | null
          size?: string | null
          slug?: string
          stock?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_fk"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          id: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit: string
          unit_cost: number
        }
        Insert: {
          id?: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit?: string
          unit_cost: number
        }
        Update: {
          id?: string
          line_total?: number
          product_id?: string
          purchase_id?: string
          quantity?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          invoice_no: string | null
          notes: string | null
          purchase_date: string
          subtotal: number
          supplier_id: string | null
          tax: number
          total: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_no?: string | null
          notes?: string | null
          purchase_date?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_no?: string | null
          notes?: string | null
          purchase_date?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "user_roles_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          gateway: string
          gateway_order_id: string | null
          id: string
          order_id: string
          response: Json | null
          status: string
          txn_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          gateway?: string
          gateway_order_id?: string | null
          id?: string
          order_id: string
          response?: Json | null
          status?: string
          txn_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          gateway?: string
          gateway_order_id?: string | null
          id?: string
          order_id?: string
          response?: Json | null
          status?: string
          txn_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_settings: {
        Row: {
          access_token: string | null
          api_version: string
          business_account_id: string | null
          created_at: string
          id: number
          is_active: boolean
          phone_number_id: string | null
          updated_at: string
          webhook_verify_token: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token?: string | null
          api_version?: string
          business_account_id?: string | null
          created_at?: string
          id?: number
          is_active?: boolean
          phone_number_id?: string | null
          updated_at?: string
          webhook_verify_token?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token?: string | null
          api_version?: string
          business_account_id?: string | null
          created_at?: string
          id?: number
          is_active?: boolean
          phone_number_id?: string | null
          updated_at?: string
          webhook_verify_token?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      order_profit_calculations: {
        Row: {
          created_at: string
          created_by: string | null
          customer_delivery: number
          gst_amount: number
          id: string
          loan_amount: number
          loan_cost: number
          loan_percent: number
          net_profit: number
          order_id: string
          profit_percent: number
          purchase_amount: number
          purchase_shipping: number
          revenue: number
          total_cost: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_delivery?: number
          gst_amount?: number
          id?: string
          loan_amount?: number
          loan_cost?: number
          loan_percent?: number
          net_profit?: number
          order_id: string
          profit_percent?: number
          purchase_amount?: number
          purchase_shipping?: number
          revenue?: number
          total_cost?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_delivery?: number
          gst_amount?: number
          id?: string
          loan_amount?: number
          loan_cost?: number
          loan_percent?: number
          net_profit?: number
          order_id?: string
          profit_percent?: number
          purchase_amount?: number
          purchase_shipping?: number
          revenue?: number
          total_cost?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_profit_calculations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profit_settings: {
        Row: {
          business_loan_amount: number
          created_at: string
          id: number
          loan_percent_default: number
          updated_at: string
        }
        Insert: {
          business_loan_amount?: number
          created_at?: string
          id?: number
          loan_percent_default?: number
          updated_at?: string
        }
        Update: {
          business_loan_amount?: number
          created_at?: string
          id?: number
          loan_percent_default?: number
          updated_at?: string
        }
        Relationships: []
      }
      mc_master_products: {
        Row: {
          id: string
          name: string
          sku: string | null
          barcode: string | null
          category_id: string | null
          subcategory: string | null
          brand_id: string | null
          description: string | null
          image_url: string | null
          size: string | null
          colour: string | null
          material: string | null
          unit: string
          purchase_price: number
          base_cost: number
          selling_price: number
          minimum_stock: number
          current_stock: number
          available_stock: number
          reserved_stock: number
          damaged_stock: number
          supplier_name: string | null
          gst_rate: number
          status: string
          linked_product_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          subcategory?: string | null
          brand_id?: string | null
          description?: string | null
          image_url?: string | null
          size?: string | null
          colour?: string | null
          material?: string | null
          unit?: string
          purchase_price?: number
          base_cost?: number
          selling_price?: number
          minimum_stock?: number
          current_stock?: number
          available_stock?: number
          reserved_stock?: number
          damaged_stock?: number
          supplier_name?: string | null
          gst_rate?: number
          status?: string
          linked_product_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          subcategory?: string | null
          brand_id?: string | null
          description?: string | null
          image_url?: string | null
          size?: string | null
          colour?: string | null
          material?: string | null
          unit?: string
          purchase_price?: number
          base_cost?: number
          selling_price?: number
          minimum_stock?: number
          current_stock?: number
          available_stock?: number
          reserved_stock?: number
          damaged_stock?: number
          supplier_name?: string | null
          gst_rate?: number
          status?: string
          linked_product_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mc_product_variants: {
        Row: {
          id: string
          master_product_id: string
          name: string
          sku: string | null
          barcode: string | null
          size: string | null
          colour: string | null
          material: string | null
          purchase_price: number
          selling_price: number
          stock: number
          image_url: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          name: string
          sku?: string | null
          barcode?: string | null
          size?: string | null
          colour?: string | null
          material?: string | null
          purchase_price?: number
          selling_price?: number
          stock?: number
          image_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          name?: string
          sku?: string | null
          barcode?: string | null
          size?: string | null
          colour?: string | null
          material?: string | null
          purchase_price?: number
          selling_price?: number
          stock?: number
          image_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      mc_channel_prices: {
        Row: {
          id: string
          master_product_id: string
          channel: string
          price: number
          min_price: number | null
          max_price: number | null
          discount_price: number | null
          promotional_price: number | null
          platform_margin_pct: number
          is_active: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          channel: string
          price?: number
          min_price?: number | null
          max_price?: number | null
          discount_price?: number | null
          promotional_price?: number | null
          platform_margin_pct?: number
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          channel?: string
          price?: number
          min_price?: number | null
          max_price?: number | null
          discount_price?: number | null
          promotional_price?: number | null
          platform_margin_pct?: number
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      mc_inventory: {
        Row: {
          id: string
          master_product_id: string
          variant_id: string | null
          physical_stock: number
          available_stock: number
          reserved_stock: number
          sold_stock: number
          damaged_stock: number
          reorder_level: number
          last_updated: string
        }
        Insert: {
          id?: string
          master_product_id: string
          variant_id?: string | null
          physical_stock?: number
          available_stock?: number
          reserved_stock?: number
          sold_stock?: number
          damaged_stock?: number
          reorder_level?: number
          last_updated?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          variant_id?: string | null
          physical_stock?: number
          available_stock?: number
          reserved_stock?: number
          sold_stock?: number
          damaged_stock?: number
          reorder_level?: number
          last_updated?: string
        }
        Relationships: [
          { foreignKeyName: "mc_inventory_master_product_id_fkey"; columns: ["master_product_id"]; isOneToOne: false; referencedRelation: "mc_master_products"; referencedColumns: ["id"] },
          { foreignKeyName: "mc_inventory_variant_id_fkey"; columns: ["variant_id"]; isOneToOne: false; referencedRelation: "mc_product_variants"; referencedColumns: ["id"] }
        ]
      }
      mc_inventory_movements: {
        Row: {
          id: string
          master_product_id: string
          variant_id: string | null
          quantity: number
          movement_type: string
          channel: string | null
          source: string | null
          destination: string | null
          reference_id: string | null
          notes: string | null
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          variant_id?: string | null
          quantity: number
          movement_type: string
          channel?: string | null
          source?: string | null
          destination?: string | null
          reference_id?: string | null
          notes?: string | null
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          variant_id?: string | null
          quantity?: number
          movement_type?: string
          channel?: string | null
          source?: string | null
          destination?: string | null
          reference_id?: string | null
          notes?: string | null
          user_id?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_inventory_movements_master_product_id_fkey"; columns: ["master_product_id"]; isOneToOne: false; referencedRelation: "mc_master_products"; referencedColumns: ["id"] }
        ]
      }
      mc_inventory_reservations: {
        Row: {
          id: string
          master_product_id: string
          variant_id: string | null
          channel: string
          order_reference: string
          quantity: number
          status: string
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          variant_id?: string | null
          channel: string
          order_reference: string
          quantity: number
          status?: string
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          variant_id?: string | null
          channel?: string
          order_reference?: string
          quantity?: number
          status?: string
          expires_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      mc_marketplace_channels: {
        Row: {
          id: string
          name: string
          channel: string
          is_enabled: boolean
          connection_status: string
          sync_frequency_minutes: number
          inventory_sync: boolean
          product_sync: boolean
          price_sync: boolean
          order_sync: boolean
          default_pricing_rule: string
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          channel: string
          is_enabled?: boolean
          connection_status?: string
          sync_frequency_minutes?: number
          inventory_sync?: boolean
          product_sync?: boolean
          price_sync?: boolean
          order_sync?: boolean
          default_pricing_rule?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          channel?: string
          is_enabled?: boolean
          connection_status?: string
          sync_frequency_minutes?: number
          inventory_sync?: boolean
          product_sync?: boolean
          price_sync?: boolean
          order_sync?: boolean
          default_pricing_rule?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_marketplace_connections_channel_id_fkey"; columns: ["id"]; isOneToOne: false; referencedRelation: "mc_marketplace_connections"; referencedColumns: ["channel_id"] }
        ]
      }
      mc_marketplace_connections: {
        Row: {
          id: string
          channel_id: string
          seller_id: string | null
          api_key_encrypted: string | null
          api_secret_encrypted: string | null
          marketplace_name: string | null
          region: string
          status: string
          last_sync_at: string | null
          error_message: string | null
          config: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          seller_id?: string | null
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          marketplace_name?: string | null
          region?: string
          status?: string
          last_sync_at?: string | null
          error_message?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel_id?: string
          seller_id?: string | null
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          marketplace_name?: string | null
          region?: string
          status?: string
          last_sync_at?: string | null
          error_message?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mc_marketplace_products: {
        Row: {
          id: string
          master_product_id: string
          channel_id: string
          marketplace_product_id: string | null
          marketplace_sku: string | null
          listing_status: string
          sync_status: string
          last_synced_at: string | null
          marketplace_data: Json
          created_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          channel_id: string
          marketplace_product_id?: string | null
          marketplace_sku?: string | null
          listing_status?: string
          sync_status?: string
          last_synced_at?: string | null
          marketplace_data?: Json
          created_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          channel_id?: string
          marketplace_product_id?: string | null
          marketplace_sku?: string | null
          listing_status?: string
          sync_status?: string
          last_synced_at?: string | null
          marketplace_data?: Json
          created_at?: string
        }
        Relationships: []
      }
      mc_marketplace_orders: {
        Row: {
          id: string
          channel_id: string
          marketplace_order_id: string
          customer_name: string | null
          customer_email: string | null
          customer_phone: string | null
          shipping_address: Json | null
          status: string
          payment_status: string | null
          payment_method: string | null
          subtotal: number
          discount: number
          shipping_charges: number
          tax: number
          total: number
          platform_fees: number
          commission: number
          net_amount: number
          marketplace_data: Json
          synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          marketplace_order_id: string
          customer_name?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          shipping_address?: Json | null
          status?: string
          payment_status?: string | null
          payment_method?: string | null
          subtotal?: number
          discount?: number
          shipping_charges?: number
          tax?: number
          total?: number
          platform_fees?: number
          commission?: number
          net_amount?: number
          marketplace_data?: Json
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel_id?: string
          marketplace_order_id?: string
          customer_name?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          shipping_address?: Json | null
          status?: string
          payment_status?: string | null
          payment_method?: string | null
          subtotal?: number
          discount?: number
          shipping_charges?: number
          tax?: number
          total?: number
          platform_fees?: number
          commission?: number
          net_amount?: number
          marketplace_data?: Json
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_marketplace_orders_channel_id_fkey"; columns: ["channel_id"]; isOneToOne: false; referencedRelation: "mc_marketplace_channels"; referencedColumns: ["id"] }
        ]
      }
      mc_marketplace_order_items: {
        Row: {
          id: string
          order_id: string
          master_product_id: string | null
          product_name: string
          sku: string | null
          quantity: number
          unit_price: number
          discount: number
          tax: number
          total: number
          marketplace_data: Json
        }
        Insert: {
          id?: string
          order_id: string
          master_product_id?: string | null
          product_name: string
          sku?: string | null
          quantity?: number
          unit_price?: number
          discount?: number
          tax?: number
          total?: number
          marketplace_data?: Json
        }
        Update: {
          id?: string
          order_id?: string
          master_product_id?: string | null
          product_name?: string
          sku?: string | null
          quantity?: number
          unit_price?: number
          discount?: number
          tax?: number
          total?: number
          marketplace_data?: Json
        }
        Relationships: [
          { foreignKeyName: "mc_marketplace_order_items_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "mc_marketplace_orders"; referencedColumns: ["id"] },
          { foreignKeyName: "mc_marketplace_order_items_master_product_id_fkey"; columns: ["master_product_id"]; isOneToOne: false; referencedRelation: "mc_master_products"; referencedColumns: ["id"] }
        ]
      }
      mc_sales_transactions: {
        Row: {
          id: string
          channel: string
          marketplace_order_id: string | null
          customer_name: string | null
          customer_email: string | null
          subtotal: number
          discount: number
          shipping: number
          tax: number
          platform_fees: number
          total: number
          payment_status: string
          order_status: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          channel: string
          marketplace_order_id?: string | null
          customer_name?: string | null
          customer_email?: string | null
          subtotal?: number
          discount?: number
          shipping?: number
          tax?: number
          platform_fees?: number
          total?: number
          payment_status?: string
          order_status?: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          channel?: string
          marketplace_order_id?: string | null
          customer_name?: string | null
          customer_email?: string | null
          subtotal?: number
          discount?: number
          shipping?: number
          tax?: number
          platform_fees?: number
          total?: number
          payment_status?: string
          order_status?: string
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_channel_prices_master_product_id_fkey"; columns: ["master_product_id"]; isOneToOne: false; referencedRelation: "mc_master_products"; referencedColumns: ["id"] }
        ]
      }
      mc_cost_components: {
        Row: {
          id: string
          master_product_id: string
          cost_type: string
          amount: number
          percentage: number | null
          description: string | null
          channel: string | null
          created_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          cost_type: string
          amount?: number
          percentage?: number | null
          description?: string | null
          channel?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          cost_type?: string
          amount?: number
          percentage?: number | null
          description?: string | null
          channel?: string | null
          created_at?: string
        }
        Relationships: []
      }
      mc_product_costs: {
        Row: {
          id: string
          master_product_id: string
          purchase_cost: number
          gst_amount: number
          shipping_cost: number
          transport_cost: number
          packaging_cost: number
          marketplace_fee: number
          commission: number
          payment_gateway_charges: number
          other_expenses: number
          landed_cost: number
          gross_profit: number
          net_profit: number
          profit_margin_pct: number
          calculated_at: string
        }
        Insert: {
          id?: string
          master_product_id: string
          purchase_cost?: number
          gst_amount?: number
          shipping_cost?: number
          transport_cost?: number
          packaging_cost?: number
          marketplace_fee?: number
          commission?: number
          payment_gateway_charges?: number
          other_expenses?: number
          landed_cost?: number
          gross_profit?: number
          net_profit?: number
          profit_margin_pct?: number
          calculated_at?: string
        }
        Update: {
          id?: string
          master_product_id?: string
          purchase_cost?: number
          gst_amount?: number
          shipping_cost?: number
          transport_cost?: number
          packaging_cost?: number
          marketplace_fee?: number
          commission?: number
          payment_gateway_charges?: number
          other_expenses?: number
          landed_cost?: number
          gross_profit?: number
          net_profit?: number
          profit_margin_pct?: number
          calculated_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_product_costs_master_product_id_fkey"; columns: ["master_product_id"]; isOneToOne: false; referencedRelation: "mc_master_products"; referencedColumns: ["id"] }
        ]
      }
      mc_sync_jobs: {
        Row: {
          id: string
          channel_id: string
          job_type: string
          status: string
          items_total: number
          items_synced: number
          items_failed: number
          error_message: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          job_type: string
          status?: string
          items_total?: number
          items_synced?: number
          items_failed?: number
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          channel_id?: string
          job_type?: string
          status?: string
          items_total?: number
          items_synced?: number
          items_failed?: number
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_sync_jobs_channel_id_fkey"; columns: ["channel_id"]; isOneToOne: false; referencedRelation: "mc_marketplace_channels"; referencedColumns: ["id"] }
        ]
      }
      mc_sync_logs: {
        Row: {
          id: string
          job_id: string
          level: string
          message: string
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          job_id: string
          level?: string
          message: string
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          level?: string
          message?: string
          details?: Json
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "mc_sync_logs_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "mc_sync_jobs"; referencedColumns: ["id"] }
        ]
      }
      mc_notifications: {
        Row: {
          id: string
          title: string
          body: string | null
          kind: string
          channel: string | null
          entity_type: string | null
          entity_id: string | null
          meta: Json
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          body?: string | null
          kind?: string
          channel?: string | null
          entity_type?: string | null
          entity_id?: string | null
          meta?: Json
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          body?: string | null
          kind?: string
          channel?: string | null
          entity_type?: string | null
          entity_id?: string | null
          meta?: Json
          is_read?: boolean
          created_at?: string
        }
        Relationships: []
      }
      mc_import_jobs: {
        Row: {
          id: string
          filename: string
          entity_type: string
          status: string
          total_rows: number
          valid_rows: number
          error_rows: number
          imported_by: string | null
          error_log: Json
          created_at: string
          completed_at: string
        }
        Insert: {
          id?: string
          filename: string
          entity_type: string
          status?: string
          total_rows?: number
          valid_rows?: number
          error_rows?: number
          imported_by?: string | null
          error_log?: Json
          created_at?: string
          completed_at?: string
        }
        Update: {
          id?: string
          filename?: string
          entity_type?: string
          status?: string
          total_rows?: number
          valid_rows?: number
          error_rows?: number
          imported_by?: string | null
          error_log?: Json
          created_at?: string
          completed_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_admin: { Args: never; Returns: boolean }
      get_profit_settings: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      save_profit_settings: {
        Args: {
          _business_loan_amount: number
          _loan_percent_default?: number
        }
        Returns: boolean
      }
      upsert_order_profit_calculation: {
        Args: {
          _gst_amount?: number
          _loan_amount?: number
          _loan_percent?: number
          _order_id: string
          _purchase_amount: number
          _purchase_shipping?: number
        }
        Returns: Json
      }
      create_purchase_with_products: {
        Args: {
          _invoice_no?: string
          _items: Json
          _notes?: string
          _purchase_date?: string
          _supplier_id: string
        }
        Returns: string
      }
      delete_purchase_with_stock_reversal: {
        Args: { _purchase_id: string }
        Returns: boolean
      }
      update_purchase_with_products: {
        Args: {
          _invoice_no?: string
          _items: Json
          _notes?: string
          _purchase_date?: string
          _purchase_id: string
          _supplier_id: string
        }
        Returns: boolean
      }
      match_or_create_product: {
        Args: {
          _brand_id: string
          _category_id: string
          _cgst_rate?: number
          _color: string
          _color_variations?: Json
          _igst_rate?: number
          _image_url?: string
          _name: string
          _purchase_price: number
          _selling_price: number
          _sgst_rate?: number
          _size: string
          _sku: string
          _unit?: string
        }
        Returns: string
      }
      convert_unit: {
        Args: { _amount: number; _from: string; _to: string }
        Returns: number
      }
      merge_color_variations: {
        Args: { _current: Json; _incoming: Json }
        Returns: Json
      }
      mark_order_paid_by_gateway: {
        Args: {
          _gateway?: string
          _gateway_order_id?: string
          _order_id: string
          _response?: Json
          _txn_id?: string
        }
        Returns: boolean
      }
      confirm_upi_payment: {
        Args: { _order_id: string; _utr: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      update_order_status: {
        Args: {
          _order_id: string
          _status: Database["public"]["Enums"]["order_status"]
          _note?: string
        }
        Returns: boolean
      }
      place_order: {
        Args: {
          _address_id: string
          _channel: Database["public"]["Enums"]["order_channel"]
          _delivery_type: Database["public"]["Enums"]["delivery_type"]
          _items: Json
          _notes?: string
          _payment_method: Database["public"]["Enums"]["payment_method"]
          _discount?: number
          _tax_type?: string
          _shipping?: number
          _state?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "customer" | "inventory_manager" | "purchase_manager" | "billing_staff" | "accounts_staff" | "marketplace_manager" | "viewer"
      delivery_type: "DELIVERY" | "PICKUP"
      order_channel: "ONLINE" | "IN_STORE"
      order_status:
        | "NEW"
        | "PROCESSING"
        | "PACKED"
        | "OUT_FOR_DELIVERY"
        | "DELIVERED"
        | "CANCELLED"
      payment_method: "ONLINE" | "COD" | "CASH" | "UPI" | "CARD"
      payment_status: "PENDING" | "PAID" | "FAILED" | "REFUNDED"
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
      app_role: ["admin", "staff", "customer", "inventory_manager", "purchase_manager", "billing_staff", "accounts_staff", "marketplace_manager", "viewer"],
      delivery_type: ["DELIVERY", "PICKUP"],
      order_channel: ["ONLINE", "IN_STORE"],
      order_status: [
        "NEW",
        "PROCESSING",
        "PACKED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
      ],
      payment_method: ["ONLINE", "COD", "CASH", "UPI", "CARD"],
      payment_status: ["PENDING", "PAID", "FAILED", "REFUNDED"],
    },
  },
} as const
