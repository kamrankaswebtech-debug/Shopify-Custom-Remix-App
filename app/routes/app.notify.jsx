import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import {
  Page,
  Card,
  DataTable,
  Text,
  Badge,
  EmptyState,
  Box,
  InlineStack,
  BlockStack,
  Thumbnail,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const requests = await prisma.notifyRequest.findMany({
    orderBy: { createdAt: "desc" },
  });

  return json({ requests });
};

export default function NotifyPage() {
  const { requests } = useLoaderData();

  if (requests.length === 0) {
    return (
      <Page title="Notify Me Requests">
        <Card>
          <EmptyState
            heading="No notify requests yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Jab koi customer "Notify Me" form fill karega, yahan dikhega.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Notify Me Requests"
      subtitle={`Total: ${requests.length} requests`}
    >
      <BlockStack gap="400">
        {requests.map((req) => (
          <Card key={req.id}>
            <Box padding="400">
              <InlineStack gap="400" align="start" blockAlign="start">
                {/* Product Image */}
                {req.productImage && (
                  <Thumbnail
                    source={req.productImage}
                    alt={req.productTitle}
                    size="large"
                  />
                )}

                {/* Details */}
                <BlockStack gap="200" style={{ flex: 1 }}>
                  {/* Product Info */}
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
                    {/* Customer Info */}
                    <BlockStack gap="100">
                      <Text variant="headingSm">👤 Customer Details</Text>

                      {req.name && (
                        <Text>
                          <strong>Name:</strong> {req.name}
                        </Text>
                      )}

                      <Text>
                        <strong>Email:</strong>{" "}
                        <a href={`mailto:${req.email}`}>{req.email}</a>
                      </Text>

                      {req.message && (
                        <Text>
                          <strong>Message:</strong> {req.message}
                        </Text>
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
            </Box>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}