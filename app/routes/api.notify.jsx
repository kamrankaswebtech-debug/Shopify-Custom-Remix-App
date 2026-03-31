import { prisma } from "../db.server";

export const loader = async ({ request }) => {
  return new Response("OK", {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
};

export const action = async ({ request }) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const formData = await request.formData();

    const productId = String(formData.get("productId") || "");
    const productTitle = String(formData.get("productTitle") || "");
    const productVariant = formData.get("productVariant") ? String(formData.get("productVariant")) : null;
    const productImage = formData.get("productImage") ? String(formData.get("productImage")) : null;
    const email = String(formData.get("email") || "");
    const name = formData.get("name") ? String(formData.get("name")) : null;
    const message = formData.get("message") ? String(formData.get("message")) : null;

    console.log("==== NOTIFY REQUEST ====");
    console.log("productId:", productId);
    console.log("email:", email);

    if (!productId || !productTitle || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "Required fields missing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const saved = await prisma.notifyRequest.create({
      data: { productId, productTitle, productVariant, productImage, email, name, message },
    });

    console.log("==== SAVED ID:", saved.id, "====");

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("==== API ERROR ====", error.message);
    console.error(error.stack);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};