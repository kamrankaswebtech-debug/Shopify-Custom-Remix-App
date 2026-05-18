import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  DataTable,
  Thumbnail,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  EmptyState,
  Banner,
  Modal,
  ResourceList,
  ResourceItem,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch recommended products from DB
  const recommendedProducts = await db.recommendedProduct.findMany({
    orderBy: { position: "asc" },
  });

  return json({ recommendedProducts });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "delete") {
    const id = formData.get("id");
    await db.recommendedProduct.delete({ where: { id } });
    return json({ success: true, message: "Product removed!" });
  }

  if (actionType === "add") {
    const productId = formData.get("productId");
    const productTitle = formData.get("productTitle");
    const productHandle = formData.get("productHandle");
    const productImage = formData.get("productImage");
    const productPrice = formData.get("productPrice");

    const existing = await db.recommendedProduct.findFirst({
      where: { productId },
    });

    if (existing) {
      return json({ error: "Product already exists in recommendations!" });
    }

    const count = await db.recommendedProduct.count();

    await db.recommendedProduct.create({
      data: {
        productId,
        productTitle,
        productHandle,
        productImage: productImage || "",
        productPrice: productPrice || "",
        position: count,
      },
    });

    return json({ success: true, message: "Product added to recommendations!" });
  }

  return json({ error: "Invalid action" });
};

export default function RecommendationsPage() {
  const { recommendedProducts } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [message, setMessage] = useState("");

  // Product Picker - Shopify's built-in picker


 const handleAddProduct = useCallback(async () => {
  try {
    const selected = await window.shopify.resourcePicker({
      type: "product",
      multiple: true,
    });

    if (selected && selected.length > 0) {
      for (const product of selected) {
        const formData = new FormData();
        formData.append("actionType", "add");
        // Product GID nahi - Variant GID use karo
        formData.append("productId", product.variants[0].id);
        formData.append("productTitle", product.title);
        formData.append("productHandle", product.handle);
        formData.append(
          "productImage",
          product.images?.[0]?.originalSrc || 
          product.images?.[0]?.src || ""
        );
        formData.append(
          "productPrice",
          product.variants?.[0]?.price || "0"
        );
        submit(formData, { method: "post" });
      }
      setMessage("Products added successfully!");
      setTimeout(() => setMessage(""), 3000);
    }
  } catch (error) {
    console.error("Resource picker error:", error);
  }
}, [submit]);

  const handleDelete = useCallback(
    (id) => {
      if (confirm("Are you sure you want to remove this product?")) {
        const formData = new FormData();
        formData.append("actionType", "delete");
        formData.append("id", id);
        submit(formData, { method: "post" });
        setMessage("Product removed!");
        setTimeout(() => setMessage(""), 3000);
      }
    },
    [submit]
  );

  const rows = recommendedProducts.map((product) => [
    <InlineStack gap="300" blockAlignment="center">
      {product.productImage ? (
        <Thumbnail
          source={product.productImage}
          alt={product.productTitle}
          size="small"
        />
      ) : (
        <Thumbnail
          source="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          alt="placeholder"
          size="small"
        />
      )}
      <Text variant="bodyMd">{product.productTitle}</Text>
    </InlineStack>,
    <Text variant="bodyMd">₹{product.productPrice}</Text>,
    <Badge tone="success">Active</Badge>,
    <Button
      tone="critical"
      variant="plain"
      onClick={() => handleDelete(product.id)}
    >
      Remove
    </Button>,
  ]);

  return (
    <Page
      title="🛒 Checkout Recommended Products"
      subtitle="These Products are Shows on Checkout Page"
      primaryAction={{
        content: "Add Product",
        onAction: handleAddProduct,
      }}
    >
      <BlockStack gap="400">
        {message && (
          <Banner tone="success" onDismiss={() => setMessage("")}>
            {message}
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              {recommendedProducts.length === 0 ? (
                <EmptyState
                  heading="Here is not any Recomended Products."
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{
                    content: "Add Product",
                    onAction: handleAddProduct,
                  }}
                >
                  <p>
                      Click on the  "Add Product" Button and Select which Products Shows on CheckOut Page.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Product", "Price", "Status", "Action"]}
                  rows={rows}
                />
              )}
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">📋 Instructions</Text>
                <Text variant="bodyMd" tone="subdued">
                  1. Click on "Add Product" 
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  2. Choose Products from Shopify product picker 
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  3. Selected products Shows on Check out page
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  4. Customer "Add to Order" for selecting products 
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}