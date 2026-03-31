import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  Page,
  Card,
  Thumbnail,
  Button,
  InlineStack,
  Badge,
  Text,
  TextField,
  Select,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const res = await admin.graphql(
    `query Products($first: Int, $last: Int, $after: String, $before: String) {
      products(first: $first, last: $last, after: $after, before: $before) {
        edges {
          cursor
          node {
            id
            title
            status
            totalInventory
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryQuantity
                  inventoryItem { id }
                }
              }
            }
            featuredImage { url }
          }
        }
        pageInfo { hasNextPage hasPreviousPage }
      }
    }`,
    {
      variables: before
        ? { last: 10, before }
        : { first: 10, after },
    }
  );

  const data = await res.json();
  return json({
    products: data.data.products.edges,
    pageInfo: data.data.products.pageInfo,
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const type = form.get("type");

  if (type === "delete") {
    await admin.graphql(
      `mutation productDelete($id: ID!) {
        productDelete(input: { id: $id }) { deletedProductId }
      }`,
      { variables: { id: form.get("productId") } }
    );
    return json({ success: true });
  }

  if (type === "product") {
    await admin.graphql(
      `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id title status }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: form.get("productId"),
            title: form.get("title"),
            status: form.get("status"),
          },
        },
      }
    );
    return json({ success: true });
  }

  if (type === "variant-price") {
    const productId = form.get("productId");
    const variantId = form.get("variantId");
    const price = form.get("price");
    const result = await admin.graphql(
      `mutation variantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId,
          variants: [{ id: variantId, price }],
        },
      }
    );
    const d = await result.json();
    const errors = d.data?.productVariantsBulkUpdate?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  if (type === "variant-inventory") {
    const inventoryItemId = form.get("inventoryItemId");
    const quantity = parseInt(form.get("quantity"), 10);

    const locRes = await admin.graphql(
      `query getLocation($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 1) {
            edges { node { location { id } } }
          }
        }
      }`,
      { variables: { id: inventoryItemId } }
    );
    const locData = await locRes.json();
    const locationId =
      locData.data?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location?.id;

    if (!locationId) return json({ success: false, error: "Location not found" });

    const invRes = await admin.graphql(
      `mutation inventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup { reason }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            name: "available",
            reason: "correction",
            ignoreCompareQuantity: true,
            quantities: [{ inventoryItemId, locationId, quantity }],
          },
        },
      }
    );
    const invData = await invRes.json();
    const errors = invData.data?.inventorySetQuantities?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  /* VARIANT PRICE + INVENTORY COMBO — ek saath dono update */
  if (type === "variant-update") {
    const productId = form.get("productId");
    const variantId = form.get("variantId");
    const price = form.get("price");
    const inventoryItemId = form.get("inventoryItemId");
    const quantity = parseInt(form.get("quantity"), 10);

    // Price update
    await admin.graphql(
      `mutation variantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId,
          variants: [{ id: variantId, price }],
        },
      }
    );

    // Inventory update
    const locRes = await admin.graphql(
      `query getLocation($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 1) {
            edges { node { location { id } } }
          }
        }
      }`,
      { variables: { id: inventoryItemId } }
    );
    const locData = await locRes.json();
    const locationId =
      locData.data?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location?.id;

    if (locationId) {
      await admin.graphql(
        `mutation inventorySet($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              name: "available",
              reason: "correction",
              ignoreCompareQuantity: true,
              quantities: [{ inventoryItemId, locationId, quantity }],
            },
          },
        }
      );
    }

    return json({ success: true });
  }

  if (type === "delete-variant") {
    await admin.graphql(
      `mutation variantDelete($productId: ID!, $variantsIds: [ID!]!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId: form.get("productId"),
          variantsIds: [form.get("variantId")],
        },
      }
    );
    return json({ success: true });
  }

  /* IMAGE UPDATE */
  if (type === "image-update") {
    const productId = form.get("productId");
    const imageUrl = form.get("imageUrl");

    // delete old product and add new 
    const addRes = await admin.graphql(
      `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ... on MediaImage { id } }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId,
          media: [{ originalSource: imageUrl, mediaContentType: "IMAGE" }],
        },
      }
    );
    const addData = await addRes.json();
    const errors = addData.data?.productCreateMedia?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  return null;
};

/* =======================
   STYLES
======================= */
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "14px" };
const thStyle = {
  textAlign: "left", padding: "10px 12px",
  borderBottom: "2px solid #e1e3e5", color: "#6d7175",
  fontWeight: 600, background: "#f6f6f7",
};
const tdStyle = { padding: "10px 12px", borderBottom: "1px solid #e1e3e5", verticalAlign: "middle" };

/* =======================
   INLINE TEXT CELL
======================= */
function InlineText({ value, onSave, type = "text", editing, onStartEdit, onCancelEdit }) {
  const [val, setVal] = useState(value);

  useEffect(() => { setVal(value); }, [value, editing]);

  const handleSave = () => {
    onCancelEdit();
    if (val !== value) onSave(val);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setVal(value); onCancelEdit(); }
  };

  if (editing) {
    return (
      <div style={{ minWidth: 120 }}>
        <TextField value={val} onChange={setVal} onBlur={handleSave}
          autoFocus type={type} onKeyDown={handleKeyDown} />
      </div>
    );
  }

  return (
    <div onClick={onStartEdit} title="Click to edit"
      style={{ cursor: "pointer", padding: "4px 6px", borderRadius: 6,
        border: "1px solid transparent", transition: "all 0.15s",
        display: "inline-block", minWidth: 60 }}
      onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid #bbb"; e.currentTarget.style.background = "#f6f6f7"; }}
      onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid transparent"; e.currentTarget.style.background = "transparent"; }}
    >
      {value ?? "—"}
    </div>
  );
}

/* =======================
   INLINE STATUS CELL
======================= */
function InlineStatus({ value, onSave, editing, onStartEdit, onCancelEdit }) {
  const [val, setVal] = useState(value);

  useEffect(() => { setVal(value); }, [value]);

  const handleChange = (newVal) => {
    setVal(newVal); onCancelEdit();
    if (newVal !== value) onSave(newVal);
  };

  if (editing) {
    return (
      <div style={{ minWidth: 110 }}>
        <Select
          options={[{ label: "Active", value: "ACTIVE" }, { label: "Draft", value: "DRAFT" }]}
          value={val} onChange={handleChange} onBlur={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div onClick={onStartEdit} title="Click to change status"
      style={{ cursor: "pointer", display: "inline-block" }}>
      <Badge tone={val === "ACTIVE" ? "success" : ""}>{val}</Badge>
    </div>
  );
}

/* =======================
   IMAGE UPLOAD CELL
======================= */
function ImageUploadCell({ productId, currentUrl, onUploadDone }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(currentUrl);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);

    // FileReader create base64 for preview 
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);

    // Shopify staged upload 
    try {
      const formData = new FormData();
      formData.append("type", "image-upload-staged");
      formData.append("productId", productId);
      formData.append("filename", file.name);
      formData.append("mimeType", file.type);
      formData.append("fileSize", file.size);

      const stageRes = await fetch(window.location.pathname, {
        method: "POST",
        body: formData,
      });
      const stageData = await stageRes.json();

      if (stageData.target) {
        // File upload staged URL 
        const uploadForm = new FormData();
        stageData.parameters.forEach(({ name, value }) => {
          uploadForm.append(name, value);
        });
        uploadForm.append("file", file);

        await fetch(stageData.target, { method: "POST", body: uploadForm });

        // resourceUrl  product image update 
        const updateForm = new FormData();
        updateForm.append("type", "image-update");
        updateForm.append("productId", productId);
        updateForm.append("imageUrl", stageData.resourceUrl);

        await fetch(window.location.pathname, { method: "POST", body: updateForm });
        onUploadDone();
      }
    } catch (err) {
      console.error("Upload failed", err);
    }
    setUploading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <img
        src={preview || ""}
        alt="product"
        style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8,
          border: "1px solid #e1e3e5", background: "#f6f6f7" }}
      />
      <input ref={fileRef} type="file" accept="image/*"
        style={{ display: "none" }} onChange={handleFile} />
      <Button size="slim" disabled={uploading}
        onClick={() => fileRef.current?.click()}>
        {uploading ? "Uploading..." : "Change"}
      </Button>
    </div>
  );
}

/* =======================
   MAIN COMPONENT
======================= */
export default function Index() {
  const { products, pageInfo } = useLoaderData();
  const submit = useSubmit();
  const navigate = useNavigate();

  const [openVariant, setOpenVariant] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [editingVariant, setEditingVariant] = useState(null);
  const [editingImageFor, setEditingImageFor] = useState(null);

  const buildMap = (prods) => {
    const map = {};
    prods.forEach(({ node }) => {
      const v = node.variants.edges[0]?.node;
      map[node.id] = {
        title: node.title,
        status: node.status,
        price: v?.price ?? "",
        inventory: String(v?.inventoryQuantity ?? ""),
        variantId: v?.id,
        inventoryItemId: v?.inventoryItem?.id ?? "",
        imageUrl: node.featuredImage?.url ?? "",
      };
    });
    return map;
  };

  const [localData, setLocalData] = useState(() => buildMap(products));

  useEffect(() => { setLocalData(buildMap(products)); }, [products]);

  const updateLocal = (productId, field, value) =>
    setLocalData((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value },
    }));

  const isEditing = (productId, field) =>
    editingCell?.productId === productId && editingCell?.field === field;
  const startEdit = (productId, field) => setEditingCell({ productId, field });
  const cancelEdit = () => setEditingCell(null);
  const isRowEditing = (productId) => editingCell?.productId === productId;

  const saveTitle = (productId, title) => {
    updateLocal(productId, "title", title);
    submit({ type: "product", productId, title, status: localData[productId].status }, { method: "post" });
  };

  const saveStatus = (productId, status) => {
    updateLocal(productId, "status", status);
    submit({ type: "product", productId, title: localData[productId].title, status }, { method: "post" });
  };

  const savePrice = (productId, rawPrice) => {
    const price = rawPrice.replace("₹", "").trim();
    updateLocal(productId, "price", price);
    const { variantId } = localData[productId];
    submit({ type: "variant-price", productId, variantId, price }, { method: "post" });
  };

  const saveInventory = (productId, quantity) => {
    updateLocal(productId, "inventory", quantity);
    const { inventoryItemId } = localData[productId];
    submit({ type: "variant-inventory", inventoryItemId, quantity }, { method: "post" });
  };

  /* Variant save — onece submit, combo action */
  const saveVariant = (productId, vr) => {
    const price = editingVariant.price.replace("₹", "").trim();
    const quantity = editingVariant.inventory;
    submit(
      {
        type: "variant-update",
        productId,
        variantId: vr.id,
        price,
        inventoryItemId: vr.inventoryItem?.id,
        quantity,
      },
      { method: "post" }
    );
    setEditingVariant(null);
  };

  return (
    <Page title="Products">
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Image</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Inventory</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(({ node }) => {
                const variants = node.variants.edges;
                const hasRealVariants =
                  variants.length > 1 || variants[0]?.node.title !== "Default Title";
                const ld = localData[node.id] || {};
                const rowEditing = isRowEditing(node.id);
                const showImageEdit = editingImageFor === node.id;

                return (
                  <>
                    <tr key={node.id}
                      style={{ background: rowEditing ? "#f0f7ff" : "transparent", transition: "background 0.2s" }}>

                      {/* IMAGE */}
                      <td style={tdStyle}>
                        {showImageEdit ? (
                          <ImageUploadCell
                            productId={node.id}
                            currentUrl={node.featuredImage?.url || ""}
                            onUploadDone={() => {
                              setEditingImageFor(null);
                              navigate(".", { replace: true });
                            }}
                          />
                        ) : (
                          <Thumbnail source={node.featuredImage?.url || ""} size="small" alt={node.title} />
                        )}
                      </td>

                      {/* TITLE */}
                      <td style={{ ...tdStyle, minWidth: 160 }}>
                        <InlineText
                          value={ld.title}
                          editing={isEditing(node.id, "title")}
                          onStartEdit={() => startEdit(node.id, "title")}
                          onCancelEdit={cancelEdit}
                          onSave={(v) => saveTitle(node.id, v)}
                        />
                      </td>

                      {/* PRICE */}
                      <td style={{ ...tdStyle, minWidth: 110 }}>
                        <InlineText
                          value={ld.price ? `₹${ld.price}` : "—"}
                          editing={isEditing(node.id, "price")}
                          onStartEdit={() => startEdit(node.id, "price")}
                          onCancelEdit={cancelEdit}
                          onSave={(v) => savePrice(node.id, v)}
                        />
                      </td>

                      {/* STATUS */}
                      <td style={tdStyle}>
                        <InlineStatus
                          value={ld.status}
                          editing={isEditing(node.id, "status")}
                          onStartEdit={() => startEdit(node.id, "status")}
                          onCancelEdit={cancelEdit}
                          onSave={(v) => saveStatus(node.id, v)}
                        />
                      </td>

                      {/* INVENTORY */}
                      <td style={{ ...tdStyle, minWidth: 90 }}>
                        <InlineText
                          value={ld.inventory}
                          editing={isEditing(node.id, "inventory")}
                          onStartEdit={() => startEdit(node.id, "inventory")}
                          onCancelEdit={cancelEdit}
                          onSave={(v) => saveInventory(node.id, v)}
                          type="number"
                        />
                      </td>

                      {/* ACTIONS */}
                      <td style={{ ...tdStyle, minWidth: 200 }}>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            variant={rowEditing ? "primary" : "secondary"}
                            onClick={() => {
                              if (rowEditing) {
                                cancelEdit();
                                setEditingImageFor(null);
                              } else {
                                startEdit(node.id, "title");
                                setEditingImageFor(node.id);
                              }
                            }}
                          >
                            {rowEditing ? "✓ Done" : "Edit"}
                          </Button>

                          {hasRealVariants && (
                            <Button size="slim"
                              onClick={() => {
                                setOpenVariant(openVariant === node.id ? null : node.id);
                                setEditingVariant(null);
                              }}>
                              {openVariant === node.id ? "Hide" : "Variants"}
                            </Button>
                          )}

                          <Button tone="critical" size="slim"
                            onClick={() => submit({ type: "delete", productId: node.id }, { method: "post" })}>
                            Delete
                          </Button>
                        </InlineStack>
                      </td>
                    </tr>

                    {/* VARIANTS EXPANDED ROW */}
                    {hasRealVariants && openVariant === node.id && (
                      <tr key={`variants-${node.id}`}>
                        <td colSpan={6} style={{ ...tdStyle, background: "#f6f6f7", paddingLeft: 40, paddingRight: 24 }}>
                          <Text variant="headingSm" as="p">Variants:</Text>
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                            {variants.map(({ node: vr }) => {
                              const isEditingThisVariant = editingVariant?.id === vr.id;
                              return (
                                <div key={vr.id}
                                  style={{
                                    background: "#fff",
                                    border: isEditingThisVariant ? "1px solid #458fff" : "1px solid #e1e3e5",
                                    borderRadius: 8, padding: "8px 14px", fontSize: 13,
                                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                                  }}>
                                  {isEditingThisVariant ? (
                                    <>
                                      <span style={{ fontWeight: 600, minWidth: 80 }}>🔹 {vr.title}</span>
                                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 13 }}>Price ₹</span>
                                        <div style={{ width: 90 }}>
                                          <TextField
                                            value={editingVariant.price}
                                            onChange={(v) => setEditingVariant({ ...editingVariant, price: v })}
                                            type="text"
                                            autoFocus
                                          />
                                        </div>
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 13 }}>Qty</span>
                                        <div style={{ width: 70 }}>
                                          <TextField
                                            value={editingVariant.inventory}
                                            onChange={(v) => setEditingVariant({ ...editingVariant, inventory: v })}
                                            type="number"
                                          />
                                        </div>
                                      </div>
                                      <Button size="slim" variant="primary"
                                        onClick={() => saveVariant(node.id, vr)}>
                                        Save
                                      </Button>
                                      <Button size="slim" onClick={() => setEditingVariant(null)}>
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <span style={{ flex: 1 }}>
                                        🔹 <strong>{vr.title}</strong> — ₹{vr.price} | Qty: {vr.inventoryQuantity}
                                      </span>
                                      <Button size="slim"
                                        onClick={() => setEditingVariant({
                                          id: vr.id,
                                          price: vr.price,
                                          inventory: String(vr.inventoryQuantity),
                                        })}>
                                        Edit
                                      </Button>
                                      <Button size="slim" tone="critical"
                                        onClick={() => submit(
                                          { type: "delete-variant", variantId: vr.id, productId: node.id },
                                          { method: "post" }
                                        )}>
                                        Delete
                                      </Button>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        <br />
        <InlineStack align="space-between" gap="300">
          <Button disabled={!pageInfo.hasPreviousPage}
            onClick={() => navigate(`?before=${products[0].cursor}`)}>
            Previous
          </Button>
          <Button disabled={!pageInfo.hasNextPage} variant="primary"
            onClick={() => navigate(`?after=${products[products.length - 1].cursor}`)}>
            Next
          </Button>
        </InlineStack>
      </Card>
    </Page>
  );
}