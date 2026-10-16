import { NextResponse } from "next/server";
import { smsAvailable } from "@/lib/contact-verification";
export async function GET() { return NextResponse.json({ smsAvailable: smsAvailable() }); }
