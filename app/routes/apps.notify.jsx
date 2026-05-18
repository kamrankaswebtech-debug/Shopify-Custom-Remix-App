import { prisma } from "../db.server";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
  "Content-Type": "application/json",
};

// ── Loader: handles GET requests from storefront ──
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  // Quiz config — active quiz fetch karo
  if (type === "quiz-config") {
    try {
      const activeQuiz = await prisma.quiz.findFirst({
        where: { status: "active" },
        include: {
          questions: { orderBy: { position: "asc" } },
          products: true,
        },
      });

      if (!activeQuiz) {
        return new Response(JSON.stringify({ quiz: null, products: [] }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      const questions = activeQuiz.questions.map((q) => ({
        question: q.question,
        answers: JSON.parse(q.answers),
      }));

      return new Response(
        JSON.stringify({
          quiz: { id: activeQuiz.id, title: activeQuiz.title, questions },
          products: activeQuiz.products,
        }),
        { status: 200, headers: corsHeaders }
      );
    } catch (error) {
      return new Response(JSON.stringify({ quiz: null, products: [] }), {
        status: 200,
        headers: corsHeaders,
      });
    }
  }

  // Default loader response
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders,
  });
};

// ── Action: handles POST requests from storefront ──
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const formData = await request.formData();
    const productId = String(formData.get("productId") || "");
    const productTitle = String(formData.get("productTitle") || "");
    const productVariant = formData.get("productVariant")
      ? String(formData.get("productVariant"))
      : null;
    const productImage = formData.get("productImage")
      ? String(formData.get("productImage"))
      : null;
    const email = String(formData.get("email") || "");
    const name = formData.get("name") ? String(formData.get("name")) : null;
    const message = formData.get("message")
      ? String(formData.get("message"))
      : null;

    if (!productId || !productTitle || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "Required fields missing" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Save to database
    await prisma.notifyRequest.create({
      data: {
        productId,
        productTitle,
        productVariant,
        productImage,
        email,
        name,
        message,
      },
    });

    // Send admin notification email
    await transporter.sendMail({
      from: `"Notify Me App" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `🔔 New Notify Request: ${productTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
            🔔 New Product Notification Request
          </h2>
          <div style="background: #f9f9f9; padding: 16px; border-radius: 6px; margin: 16px 0;">
            <h3 style="color: #444; margin-top: 0;">🛍️ Product Details</h3>
            ${productImage ? `<img src="${productImage}" alt="${productTitle}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 6px; margin-bottom: 10px;" />` : ""}
            <p><strong>Product:</strong> ${productTitle}</p>
            ${productVariant ? `<p><strong>Variant:</strong> ${productVariant}</p>` : ""}
            <p><strong>Product ID:</strong> ${productId}</p>
          </div>
          <div style="background: #f0f7ff; padding: 16px; border-radius: 6px; margin: 16px 0;">
            <h3 style="color: #444; margin-top: 0;">👤 Customer Details</h3>
            ${name ? `<p><strong>Name:</strong> ${name}</p>` : ""}
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
          </div>
          <div style="background: #fff3cd; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; color: #856404;">
              📅 Received at: ${new Date().toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <a href="https://admin.shopify.com/store/kamrankaswebtech123/apps/remix-app-test-2/app/notify"
             style="display: inline-block; background: #333; color: #fff; padding: 12px 24px; border-radius: 4px; text-decoration: none; margin-top: 8px;">
            View All Requests
          </a>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("==== ERROR ====", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
};