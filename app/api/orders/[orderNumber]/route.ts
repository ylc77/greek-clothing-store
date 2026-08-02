import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{orderNumber:string}>}){
  const orderNumber=decodeURIComponent((await params).orderNumber).trim();
  const token=request.headers.get("x-order-access-token")||"";
  if(!/^WEB-[A-Z0-9-]{10,40}$/.test(orderNumber)||!/^[A-Za-z0-9_-]{43}$/.test(token))return NextResponse.json({error:"Order not found."},{status:404});
  const supabase=getSupabaseAdminClient(); if(!supabase)return NextResponse.json({error:"Order status is unavailable."},{status:503});
  const{data:order,error}=await(supabase as any).from("online_orders").select("id,order_number,status,fulfillment_method,payment_method,payment_status,subtotal,shipping_total,total,currency,locale,created_at,updated_at,access_token_hash").eq("order_number",orderNumber).maybeSingle();
  if(error||!order)return NextResponse.json({error:"Order not found."},{status:404});
  const expected=Buffer.from(String(order.access_token_hash),"hex");const actual=Buffer.from(createHash("sha256").update(token).digest("hex"),"hex");
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return NextResponse.json({error:"Order not found."},{status:404});
  const{data:items,error:itemsError}=await(supabase as any).from("online_order_items").select("product_sku,name_en,name_gr,size,color,quantity,unit_price,line_total,image_url").eq("order_id",order.id).order("created_at",{ascending:true});
  if(itemsError)return NextResponse.json({error:"Order status is unavailable."},{status:503});
  const{access_token_hash:_,...safeOrder}=order;return NextResponse.json({ok:true,order:{...safeOrder,items:items||[]}},{headers:{"Cache-Control":"no-store"}});
}
