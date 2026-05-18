import { json } from "@remix-run/node";
import db from "../db.server";

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
      },
    });
  }

  try {
    const products = await db.recommendedProduct.findMany({
      where: { isActive: true },
      orderBy: { position: "asc" },
    });

    return json(
      { products },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
          "Cache-Control": "no-cache",
        },
      }
    );
  } catch (error) {
    return json(
      { products: [] },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
};

export const action = async ({ request }) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const method = request.method;

  if (method === "POST") {
    try {
      const body = await request.json();
      const { productId, productTitle, productHandle, productImage, productPrice } = body;

      const existing = await db.recommendedProduct.findFirst({
        where: { productId },
      });

      if (existing) {
        return json({ error: "Product already added" }, { status: 400, headers: corsHeaders });
      }

      const count = await db.recommendedProduct.count();

      const product = await db.recommendedProduct.create({
        data: {
          productId,
          productTitle,
          productHandle,
          productImage: productImage || "",
          productPrice: productPrice || "",
          position: count,
        },
      });

      return json({ success: true, product }, { headers: corsHeaders });
    } catch (error) {
      return json({ error: "Server error" }, { status: 500, headers: corsHeaders });
    }
  }

  if (method === "DELETE") {
    try {
      const body = await request.json();
      const { id } = body;
      await db.recommendedProduct.delete({ where: { id } });
      return json({ success: true }, { headers: corsHeaders });
    } catch (error) {
      return json({ error: "Server error" }, { status: 500, headers: corsHeaders });
    }
  }

  return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
};