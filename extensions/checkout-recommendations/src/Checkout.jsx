import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default function () {
  render(<Extension />, document.body);
}

function Extension() {
  const { applyCartLinesChange, query, i18n, lines } = shopify;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    // Cart mein jo products hain unka pehla product ka ID lo
    const cartLines = lines.value;
    if (!cartLines || cartLines.length === 0) {
      setLoading(false);
      return;
    }

    // Pehle cart line ka product ID
    const firstProductId = cartLines[0].merchandise.product.id;

    fetchRecommendations(firstProductId);
  }, []);

  async function fetchRecommendations(productId) {
    try {
      const { data } = await query(
        `query getRecommendations($productId: ID!) {
          productRecommendations(productId: $productId) {
            id
            title
            images(first: 1) {
              nodes {
                url
              }
            }
            variants(first: 1) {
              nodes {
                id
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }`,
        { variables: { productId } }
      );

      if (data && data.productRecommendations) {
        setProducts(data.productRecommendations);
      }
    } catch (error) {
      console.error("Fetch recommendations error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (showError) {
      const timer = setTimeout(() => setShowError(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showError]);

  async function handleAddToCart(variantId) {
    setAdding(variantId);
    const result = await applyCartLinesChange({
      type: "addCartLine",
      merchandiseId: variantId,
      quantity: 1,
    });
    setAdding(null);
    if (result.type === "error") {
      setShowError(true);
      console.error(result.message);
    }
  }

  if (loading) {
    return (
      <s-stack gap="large-200">
        <s-divider />
        <s-heading>You might also like</s-heading>
        <s-grid gridTemplateColumns="64px 1fr auto" gap="base" alignItems="center">
          <s-image loading="lazy" />
          <s-stack gap="none">
            <s-skeleton-paragraph />
            <s-skeleton-paragraph />
          </s-stack>
          <s-button variant="secondary" disabled={true}>Add</s-button>
        </s-grid>
      </s-stack>
    );
  }

  // Cart mein already jo hain unhe filter karo
  const cartVariantIds = lines.value.map(item => item.merchandise.id);
  const productsOnOffer = products.filter(product =>
    !product.variants.nodes.some(v => cartVariantIds.includes(v.id))
  );

  if (!productsOnOffer.length) return null;

  return (
    <s-stack gap="large-200">
      <s-divider />
      <s-heading>You might also like</s-heading>
      {productsOnOffer.slice(0, 3).map(product => {
        const variant = product.variants.nodes[0];
        const imageUrl = product.images.nodes[0]?.url ||
          "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png";
        const price = i18n.formatCurrency(parseFloat(variant.price.amount));

        return (
          <s-stack key={product.id} gap="base">
            <s-grid
              gap="base"
              gridTemplateColumns="64px 1fr auto"
              alignItems="center"
            >
              <s-image
                borderWidth="base"
                borderRadius="large-100"
                src={imageUrl}
                alt={product.title}
                aspectRatio="1"
              />
              <s-stack gap="none">
                <s-text type="strong">{product.title}</s-text>
                <s-text color="subdued">{price}</s-text>
              </s-stack>
              <s-button
                variant="secondary"
                loading={adding === variant.id}
                accessibilityLabel={`Add ${product.title} to cart`}
                onClick={() => handleAddToCart(variant.id)}
              >
                Add
              </s-button>
            </s-grid>
          </s-stack>
        );
      })}
      {showError && (
        <s-banner tone="critical">
          There was an issue adding this product. Please try again.
        </s-banner>
      )}
    </s-stack>
  );
}