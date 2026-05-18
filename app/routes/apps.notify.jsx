import { prisma } from "../db.server";

export const loader = async ({ request }) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const action = async ({ request }) => {
  try {
    const formData = await request.formData();

    const productId = String(formData.get("productId") || "");
    const productTitle = String(formData.get("productTitle") || "");
    const productVariant = formData.get("productVariant") ? String(formData.get("productVariant")) : null;
    const productImage = formData.get("productImage") ? String(formData.get("productImage")) : null;
    const email = String(formData.get("email") || "");
    const name = formData.get("name") ? String(formData.get("name")) : null;
    const message = formData.get("message") ? String(formData.get("message")) : null;

    console.log("==== PROXY NOTIFY HIT ====", { productId, email });

    if (!productId || !productTitle || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "Required fields missing" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await prisma.notifyRequest.create({
      data: { productId, productTitle, productVariant, productImage, email, name, message },
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("==== ERROR ====", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};