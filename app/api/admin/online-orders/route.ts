import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  const authorization=await authorizeAdminRequest(request,"online_orders:read");if(!authorization.allowed)return adminAuthorizationFailure(authorization);
  if(!(await isFeatureEnabled("online_orders")))return featureDisabledResponse("online_orders");
  const supabase=getSupabaseAdminClient();if(!supabase)return NextResponse.json({error:"在线订单数据库未配置。",code:"ONLINE_ORDER_UNAVAILABLE"},{status:503});
  const url=new URL(request.url);const status=(url.searchParams.get("status")||"all").trim();const query=(url.searchParams.get("q")||"").trim().slice(0,120);const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50));
  let db=(supabase as any).from("online_orders").select("id,order_number,status,fulfillment_method,payment_method,payment_status,subtotal,shipping_total,total,currency,customer_name,customer_email,customer_phone,address_line1,city,postal_code,customer_notes,locale,created_at,updated_at",{count:"exact"}).order("created_at",{ascending:false}).limit(limit);
  if(status!=="all")db=db.eq("status",status);if(query)db=db.or(`order_number.ilike.%${query.replace(/[%(),]/g,"")}%,customer_name.ilike.%${query.replace(/[%(),]/g,"")}%,customer_phone.ilike.%${query.replace(/[%(),]/g,"")}%`);
  const{data,error,count}=await db;if(error){console.error("[online orders] list unavailable",{code:String(error.code||""),message:String(error.message||"")});return NextResponse.json({error:"在线订单读取失败。",code:"ONLINE_ORDER_UNAVAILABLE"},{status:503});}
  const ids=(data||[]).map((order:any)=>order.id);const{data:items,error:itemsError}=ids.length?await(supabase as any).from("online_order_items").select("order_id,product_sku,variant_sku,name_en,name_gr,size,color,quantity,unit_price,line_total,image_url").in("order_id",ids).order("created_at",{ascending:true}):{data:[],error:null};if(itemsError)return NextResponse.json({error:"在线订单明细读取失败。",code:"ONLINE_ORDER_UNAVAILABLE"},{status:503});
  const byOrder=new Map<string,any[]>();for(const item of items||[]){const rows=byOrder.get(item.order_id)||[];rows.push(item);byOrder.set(item.order_id,rows);}return NextResponse.json({ok:true,total:count||0,orders:(data||[]).map((order:any)=>({...order,items:byOrder.get(order.id)||[]}))});
}
