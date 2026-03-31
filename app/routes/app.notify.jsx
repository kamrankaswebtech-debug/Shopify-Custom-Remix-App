import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import nodemailer from "nodemailer";
import {
  Page,
  Card,
  Text,
  Badge,
  EmptyState,
  Box,
  InlineStack,
  BlockStack,
  Thumbnail,
  Button,
  Banner,
} from "@shopify/polaris";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const requests = await prisma.notifyRequest.findMany({
    orderBy: { createdAt: "desc" },
  });
  return json({ requests });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id"));

  if (intent === "delete") {
    await prisma.notifyRequest.delete({ where: { id } });
    return json({ success: true, message: "Request deleted!" });
  }

  if (intent === "notify") {
    const email = formData.get("email");
    const productTitle = formData.get("productTitle");
    const productImage = formData.get("productImage");
    const productVariant = formData.get("productVariant");

    await transporter.sendMail({
      from: `"Kamran Store" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `✅ ${productTitle} is back in stock!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #333;">Good news! Your product is available 🎉</h2>
          ${productImage ? `<img src="${productImage}" alt="${productTitle}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 8px; margin: 16px 0;" />` : ""}
          <h3 style="color: #444;">${productTitle}</h3>
          ${productVariant ? `<p style="color: #666;">Variant: <strong>${productVariant}</strong></p>` : ""}
          <p style="color: #555;">The product you requested is now back in stock. Hurry up before it sells out again!</p>
          <a href="https://kamrankaswebtech123.myshopify.com" style="display: inline-block; background: #333; color: #fff; padding: 12px 24px; border-radius: 4px; text-decoration: none; margin-top: 16px;">Shop Now</a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">You received this email because you requested to be notified about this product.</p>
        </div>
      `,
    });

    await prisma.notifyRequest.delete({ where: { id } });
    return json({ success: true, message: `Email sent to ${email}!` });
  }

  return json({ success: false });
};

export default function NotifyPage() {
  const { requests } = useLoaderData();
  const fetcher = useFetcher();

  const isLoading = fetcher.state !== "idle";
  const message = fetcher.data?.message;

  if (requests.length === 0) {
    return (
      <Page title="Notify Me Requests">
        <Card>
          <EmptyState
            heading="No notify requests yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>When any Customer filled "Notify Me" Form Present's Here! </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="🔔 Notify Me Requests"
      subtitle={`Total: ${requests.length} requests`}
    >
      <BlockStack gap="400">
        {message && (
          <Banner tone="success" onDismiss={() => {}}>
            {message}
          </Banner>
        )}

        {requests.map((req) => (
          <Card key={req.id}>
            <Box padding="400">
              <InlineStack gap="400" align="space-between" blockAlign="start">
                <InlineStack gap="400" blockAlign="start">
                  {req.productImage && (
                    <Thumbnail
                      source={req.productImage}
                      alt={req.productTitle}
                      size="large"
                    />
                  )}
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">
                      🛍️ {req.productTitle}
                    </Text>
                    {req.productVariant && (
                      <Badge tone="info">Variant: {req.productVariant}</Badge>
                    )}
                    <Text variant="bodySm" tone="subdued">
                      Product ID: {req.productId}
                    </Text>

                    <Box
                      paddingBlockStart="200"
                      borderBlockStartWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <Text variant="headingSm">👤 Customer Details</Text>
                        {req.name && <Text><strong>Name:</strong> {req.name}</Text>}
                        <Text>
                          <strong>Email:</strong>{" "}
                          <a href={`mailto:${req.email}`}>{req.email}</a>
                        </Text>
                        {req.message && (
                          <Text><strong>Message:</strong> {req.message}</Text>
                        )}
                        <Text variant="bodySm" tone="subdued">
                          📅 {new Date(req.createdAt).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </Text>
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </InlineStack>

                {/* Action Buttons */}
                <BlockStack gap="200">
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="notify" />
                    <input type="hidden" name="id" value={req.id} />
                    <input type="hidden" name="email" value={req.email} />
                    <input type="hidden" name="productTitle" value={req.productTitle} />
                    <input type="hidden" name="productImage" value={req.productImage || ""} />
                    <input type="hidden" name="productVariant" value={req.productVariant || ""} />
                    <Button
                      variant="primary"
                      tone="success"
                      submit
                      loading={isLoading}
                    >
                      📧 Send Notification
                    </Button>
                  </fetcher.Form>

                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={req.id} />
                    <Button
                      variant="primary"
                      tone="critical"
                      submit
                      loading={isLoading}
                    >
                      🗑️ Delete
                    </Button>
                  </fetcher.Form>
                </BlockStack>
              </InlineStack>
            </Box>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}