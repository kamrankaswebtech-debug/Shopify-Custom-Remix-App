import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { useState, useMemo } from "react";
import {
  Page, Card, Text, Button, Box, InlineStack,
  BlockStack, Badge, EmptyState, TextField, Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

// ── Loader ──
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const quizzes = await prisma.quiz.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      questions: { orderBy: { position: "asc" } },
      products: true,
    },
  });

  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const res = await admin.graphql(`
      query GetProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            cursor
            node {
              id title handle
              featuredImage { url }
              variants(first: 100) {
                edges {
                  node {
                    id title price
                    image { url }
                    selectedOptions { name value }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { variables: { first: 250, after: cursor } });

    const data = await res.json();
    const edges = data.data.products.edges;
    allProducts = allProducts.concat(edges.map(({ node }) => node));
    hasNextPage = data.data.products.pageInfo.hasNextPage;
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
  }

  return json({ quizzes, shopifyProducts: allProducts });
};

// ── Action ──
export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Generate quiz with Groq AI
  if (intent === "generate-ai") {
    const selectedProducts = JSON.parse(formData.get("products"));
    const quizTitle = String(formData.get("quizTitle") || "Style Finder Quiz");
    const manualQuestionsJson = formData.get("manualQuestions");
    const manualQuestions = manualQuestionsJson ? JSON.parse(manualQuestionsJson) : [];

    const productInfo = selectedProducts.map((p) => {
      const variants = p.variants.map((v) => v.title).join(", ");
      return `- ${p.title} (Variants: ${variants}, Handle: ${p.handle})`;
    }).join("\n");

    try {
      const Groq = (await import("groq-sdk")).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `You are a quiz builder for a Shopify clothing store. Based on these products, generate 3 quiz questions to help customers find their perfect product.

Products:
${productInfo}

Rules:
- Question 1: About style/occasion preference
- Question 2: About color preference — use ONLY the actual colors available in the products
- Question 3: About size preference — use ONLY the actual sizes available
- Each question must have exactly 4 answer options
- Answers must match actual product variants

Respond ONLY with valid JSON in this exact format, no extra text:
{
  "questions": [
    {
      "question": "Question text here?",
      "answers": ["Answer 1", "Answer 2", "Answer 3", "Answer 4"]
    }
  ]
}`,
        }],
      });

      const rawText = completion.choices[0]?.message?.content || "";
      let aiResult;
      try {
        const clean = rawText.replace(/```json|```/g, "").trim();
        aiResult = JSON.parse(clean);
      } catch {
        return json({ success: false, error: "AI response parse failed. Please try again." });
      }

      const allQuestions = [...aiResult.questions, ...manualQuestions];

      const quiz = await prisma.quiz.create({
        data: {
          title: quizTitle,
          status: "draft",
          questions: {
            create: allQuestions.map((q, i) => ({
              question: q.question,
              answers: JSON.stringify(q.answers),
              position: i,
            })),
          },
        },
      });

      for (const p of selectedProducts) {
        for (const v of p.variants) {
          const colorOpt = v.selectedOptions?.find((o) => o.name.toLowerCase() === "color");
          const sizeOpt = v.selectedOptions?.find((o) => o.name.toLowerCase() === "size");
          await prisma.quizProduct.create({
            data: {
              quizId: quiz.id,
              category: p.handle,
              color: colorOpt?.value || "",
              size: sizeOpt?.value || "",
              variantId: v.id.replace("gid://shopify/ProductVariant/", ""),
              imageUrl: v.image?.url || p.featuredImage?.url || "",
              title: p.title,
              handle: p.handle,
            },
          });
        }
      }

      return json({
        success: true,
        message: `Quiz "${quizTitle}" created with ${aiResult.questions.length} AI + ${manualQuestions.length} manual questions!`,
      });
    } catch (err) {
      return json({ success: false, error: `AI Error: ${err.message}` });
    }
  }

  // Save manual-only quiz
  if (intent === "generate-manual") {
    const selectedProducts = JSON.parse(formData.get("products"));
    const quizTitle = String(formData.get("quizTitle") || "Style Finder Quiz");
    const manualQuestions = JSON.parse(formData.get("manualQuestions"));

    if (manualQuestions.length === 0) {
      return json({ success: false, error: "Please add at least 1 manual question." });
    }

    const quiz = await prisma.quiz.create({
      data: {
        title: quizTitle,
        status: "draft",
        questions: {
          create: manualQuestions.map((q, i) => ({
            question: q.question,
            answers: JSON.stringify(q.answers),
            position: i,
          })),
        },
      },
    });

    for (const p of selectedProducts) {
      for (const v of p.variants) {
        const colorOpt = v.selectedOptions?.find((o) => o.name.toLowerCase() === "color");
        const sizeOpt = v.selectedOptions?.find((o) => o.name.toLowerCase() === "size");
        await prisma.quizProduct.create({
          data: {
            quizId: quiz.id,
            category: p.handle,
            color: colorOpt?.value || "",
            size: sizeOpt?.value || "",
            variantId: v.id.replace("gid://shopify/ProductVariant/", ""),
            imageUrl: v.image?.url || p.featuredImage?.url || "",
            title: p.title,
            handle: p.handle,
          },
        });
      }
    }

    return json({
      success: true,
      message: `Quiz "${quizTitle}" created with ${manualQuestions.length} manual questions!`,
    });
  }

  // Update single question + answers
  if (intent === "update-question") {
    const questionId = String(formData.get("questionId"));
    const question = String(formData.get("question"));
    const answers = JSON.parse(formData.get("answers"));

    await prisma.quizQuestion.update({
      where: { id: questionId },
      data: {
        question,
        answers: JSON.stringify(answers),
      },
    });
    return json({ success: true, message: "Question updated!" });
  }

  // Update quiz title
  if (intent === "update-title") {
    const quizId = String(formData.get("quizId"));
    const title = String(formData.get("title"));
    await prisma.quiz.update({
      where: { id: quizId },
      data: { title },
    });
    return json({ success: true, message: "Quiz title updated!" });
  }

  // Delete single question
  if (intent === "delete-question") {
    const questionId = String(formData.get("questionId"));
    await prisma.quizQuestion.delete({ where: { id: questionId } });
    return json({ success: true, message: "Question deleted!" });
  }

  // Add question to existing quiz
  if (intent === "add-question") {
    const quizId = String(formData.get("quizId"));
    const question = String(formData.get("question"));
    const answers = JSON.parse(formData.get("answers"));

    const count = await prisma.quizQuestion.count({ where: { quizId } });
    await prisma.quizQuestion.create({
      data: {
        quizId,
        question,
        answers: JSON.stringify(answers),
        position: count,
      },
    });
    return json({ success: true, message: "Question added to quiz!" });
  }

  // Delete quiz
  if (intent === "delete-quiz") {
    const quizId = String(formData.get("quizId"));
    await prisma.quizProduct.deleteMany({ where: { quizId } });
    await prisma.quizQuestion.deleteMany({ where: { quizId } });
    await prisma.quiz.delete({ where: { id: quizId } });
    return json({ success: true, message: "Quiz deleted!" });
  }

  // Activate quiz
  if (intent === "activate") {
    const quizId = String(formData.get("quizId"));
    await prisma.quiz.updateMany({ data: { status: "draft" } });
    await prisma.quiz.update({ where: { id: quizId }, data: { status: "active" } });
    return json({ success: true, message: "Quiz is now active on storefront!" });
  }

  return json({ success: false });
};

const emptyQuestion = () => ({ question: "", answers: ["", "", "", ""] });

// ── Quiz Editor Component ──
function QuizEditor({ quiz, fetcher }) {
  const isLoading = fetcher.state !== "idle";

  // Title edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(quiz.title);

  // Per-question edit state: { [questionId]: { question, answers } }
  const [editingMap, setEditingMap] = useState({});

  // New question form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQ, setNewQ] = useState(emptyQuestion());

  const startEdit = (q) => {
    setEditingMap((prev) => ({
      ...prev,
      [q.id]: {
        question: q.question,
        answers: JSON.parse(q.answers),
      },
    }));
  };

  const cancelEdit = (id) => {
    setEditingMap((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  const updateEditQ = (id, value) => {
    setEditingMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], question: value },
    }));
  };

  const updateEditA = (id, aIndex, value) => {
    setEditingMap((prev) => {
      const answers = [...prev[id].answers];
      answers[aIndex] = value;
      return { ...prev, [id]: { ...prev[id], answers } };
    });
  };

  const saveQuestion = (questionId) => {
    const data = editingMap[questionId];
    const fd = new FormData();
    fd.append("intent", "update-question");
    fd.append("questionId", questionId);
    fd.append("question", data.question);
    fd.append("answers", JSON.stringify(data.answers));
    fetcher.submit(fd, { method: "post" });
    cancelEdit(questionId);
  };

  const deleteQuestion = (questionId) => {
    const fd = new FormData();
    fd.append("intent", "delete-question");
    fd.append("questionId", questionId);
    fetcher.submit(fd, { method: "post" });
  };

  const saveTitle = () => {
    const fd = new FormData();
    fd.append("intent", "update-title");
    fd.append("quizId", quiz.id);
    fd.append("title", titleValue);
    fetcher.submit(fd, { method: "post" });
    setEditingTitle(false);
  };

  const addNewQuestion = () => {
    if (!newQ.question.trim()) return;
    const fd = new FormData();
    fd.append("intent", "add-question");
    fd.append("quizId", quiz.id);
    fd.append("question", newQ.question);
    fd.append("answers", JSON.stringify(newQ.answers));
    fetcher.submit(fd, { method: "post" });
    setNewQ(emptyQuestion());
    setShowAddForm(false);
  };

  return (
    <Box padding="400" borderWidth="025" borderColor="border" borderRadius="200">
      <BlockStack gap="300">

        {/* Quiz Title + Status */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            {editingTitle ? (
              <InlineStack gap="200" blockAlign="center">
                <div style={{ minWidth: 220 }}>
                  <TextField
                    value={titleValue}
                    onChange={setTitleValue}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <Button size="slim" variant="primary" onClick={saveTitle} loading={isLoading}>
                  Save
                </Button>
                <Button size="slim" onClick={() => { setEditingTitle(false); setTitleValue(quiz.title); }}>
                  Cancel
                </Button>
              </InlineStack>
            ) : (
              <InlineStack gap="200" blockAlign="center">
                <Text variant="headingSm">{quiz.title}</Text>
                <Button size="slim" onClick={() => setEditingTitle(true)}>✏️ Edit Title</Button>
              </InlineStack>
            )}
            <Badge tone={quiz.status === "active" ? "success" : ""}>
              {quiz.status === "active" ? "🟢 Active" : "⚪ Draft"}
            </Badge>
          </InlineStack>

          {/* Activate + Delete */}
          <InlineStack gap="200">
            {quiz.status !== "active" && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="activate" />
                <input type="hidden" name="quizId" value={quiz.id} />
                <Button variant="primary" submit size="slim">✅ Set Active</Button>
              </fetcher.Form>
            )}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete-quiz" />
              <input type="hidden" name="quizId" value={quiz.id} />
              <Button variant="primary" tone="critical" submit size="slim">🗑️ Delete Quiz</Button>
            </fetcher.Form>
          </InlineStack>
        </InlineStack>

        {/* Questions List */}
        {quiz.questions.map((q, i) => {
          const isEditing = !!editingMap[q.id];
          const editData = editingMap[q.id];
          const answers = isEditing ? editData.answers : JSON.parse(q.answers);

          return (
            <Box
              key={q.id}
              padding="300"
              background="bg-surface-secondary"
              borderRadius="150"
            >
              <BlockStack gap="200">
                {isEditing ? (
                  // Edit mode
                  <>
                    <TextField
                      label={`Q${i + 1} — Edit Question`}
                      value={editData.question}
                      onChange={(val) => updateEditQ(q.id, val)}
                      autoComplete="off"
                      autoFocus
                    />
                    <Text variant="bodySm" fontWeight="semibold">Edit Answer Options:</Text>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      {answers.map((ans, aIndex) => (
                        <TextField
                          key={aIndex}
                          label={`Option ${aIndex + 1}`}
                          value={ans}
                          onChange={(val) => updateEditA(q.id, aIndex, val)}
                          autoComplete="off"
                        />
                      ))}
                    </div>
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        size="slim"
                        onClick={() => saveQuestion(q.id)}
                        loading={isLoading}
                      >
                        💾 Save Question
                      </Button>
                      <Button size="slim" onClick={() => cancelEdit(q.id)}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </>
                ) : (
                  // View mode
                  <>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="bodySm" fontWeight="semibold">
                        Q{i + 1}: {q.question}
                      </Text>
                      <InlineStack gap="200">
                        <Button size="slim" onClick={() => startEdit(q)}>
                          ✏️ Edit
                        </Button>
                        <Button
                          size="slim"
                          tone="critical"
                          onClick={() => deleteQuestion(q.id)}
                          loading={isLoading}
                        >
                          🗑️
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    <InlineStack gap="200" wrap>
                      {answers.map((a, j) => (
                        <Badge key={j}>{a}</Badge>
                      ))}
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Box>
          );
        })}

        {/* Add New Question to existing quiz */}
        {showAddForm ? (
          <Box padding="300" borderWidth="025" borderColor="border" borderRadius="150">
            <BlockStack gap="200">
              <Text variant="bodySm" fontWeight="semibold">New Question:</Text>
              <TextField
                label="Question Text"
                value={newQ.question}
                onChange={(val) => setNewQ((prev) => ({ ...prev, question: val }))}
                placeholder="e.g. What is your preferred style?"
                autoComplete="off"
                autoFocus
              />
              <Text variant="bodySm" fontWeight="semibold">Answer Options:</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {newQ.answers.map((ans, aIndex) => (
                  <TextField
                    key={aIndex}
                    label={`Option ${aIndex + 1}`}
                    value={ans}
                    onChange={(val) => {
                      const answers = [...newQ.answers];
                      answers[aIndex] = val;
                      setNewQ((prev) => ({ ...prev, answers }));
                    }}
                    placeholder={`Answer ${aIndex + 1}`}
                    autoComplete="off"
                  />
                ))}
              </div>
              <InlineStack gap="200">
                <Button variant="primary" size="slim" onClick={addNewQuestion} loading={isLoading}>
                  ➕ Add Question
                </Button>
                <Button size="slim" onClick={() => { setShowAddForm(false); setNewQ(emptyQuestion()); }}>
                  Cancel
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        ) : (
          <Button size="slim" onClick={() => setShowAddForm(true)}>
            ➕ Add New Question to This Quiz
          </Button>
        )}

        {/* Products in quiz */}
        <Text variant="bodySm" tone="subdued">
          Products: {[...new Set(quiz.products.map((p) => p.title))].join(", ")}
        </Text>

      </BlockStack>
    </Box>
  );
}

// ── Main Page ──
export default function QuizBuilderPage() {
  const { quizzes, shopifyProducts } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  const message = fetcher.data?.message;
  const error = fetcher.data?.error;

  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [quizTitle, setQuizTitle] = useState("Style Finder Quiz");
  const [manualQuestions, setManualQuestions] = useState([]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return shopifyProducts.slice(0, 20);
    return shopifyProducts.filter((p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, shopifyProducts]);

  const toggleProduct = (product) => {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      if (exists) return prev.filter((p) => p.id !== product.id);
      return [...prev, product];
    });
  };

  const addManualQuestion = () => setManualQuestions((prev) => [...prev, emptyQuestion()]);
  const removeManualQuestion = (i) => setManualQuestions((prev) => prev.filter((_, idx) => idx !== i));
  const updateQuestion = (i, val) => setManualQuestions((prev) => {
    const u = [...prev]; u[i] = { ...u[i], question: val }; return u;
  });
  const updateAnswer = (qi, ai, val) => setManualQuestions((prev) => {
    const u = [...prev];
    const ans = [...u[qi].answers];
    ans[ai] = val;
    u[qi] = { ...u[qi], answers: ans };
    return u;
  });

  const getProductsData = () => selectedProducts.map((p) => ({
    id: p.id, title: p.title, handle: p.handle,
    featuredImage: p.featuredImage,
    variants: p.variants.edges.map(({ node }) => ({
      id: node.id, title: node.title, price: node.price,
      image: node.image, selectedOptions: node.selectedOptions,
    })),
  }));

  const validManual = manualQuestions.filter(
    (q) => q.question.trim() && q.answers.some((a) => a.trim())
  );

  const handleGenerateAI = () => {
    if (selectedProducts.length === 0) return;
    const fd = new FormData();
    fd.append("intent", "generate-ai");
    fd.append("quizTitle", quizTitle);
    fd.append("products", JSON.stringify(getProductsData()));
    fd.append("manualQuestions", JSON.stringify(validManual));
    fetcher.submit(fd, { method: "post" });
    setSelectedProducts([]); setManualQuestions([]);
  };

  const handleGenerateManual = () => {
    if (selectedProducts.length === 0 || validManual.length === 0) return;
    const fd = new FormData();
    fd.append("intent", "generate-manual");
    fd.append("quizTitle", quizTitle);
    fd.append("products", JSON.stringify(getProductsData()));
    fd.append("manualQuestions", JSON.stringify(validManual));
    fetcher.submit(fd, { method: "post" });
    setSelectedProducts([]); setManualQuestions([]);
  };

  return (
    <Page title="🤖 AI Quiz Builder" subtitle="Create, edit, and manage quizzes">
      <TitleBar title="AI Quiz Builder" />
      <BlockStack gap="500">

        {message && <Banner tone="success" onDismiss={() => {}}>{message}</Banner>}
        {error && <Banner tone="critical" onDismiss={() => {}}>{error}</Banner>}

        {/* ── CREATE NEW QUIZ ── */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">✨ Create New Quiz</Text>

            <TextField label="Quiz Title" value={quizTitle}
              onChange={setQuizTitle} autoComplete="off"
              placeholder="e.g. Style Finder Quiz" />

            <Box>
              <Text variant="bodySm" as="p" fontWeight="semibold">Search & Select Products</Text>
              <Box paddingBlockStart="100">
                <div style={{ position: "relative" }}>
                  <TextField
                    placeholder="Type product name to search..."
                    value={searchQuery}
                    onChange={(val) => { setSearchQuery(val); setDropdownOpen(true); }}
                    onFocus={() => setDropdownOpen(true)}
                    autoComplete="off" prefix="🔍"
                  />
                  {dropdownOpen && filteredProducts.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#fff", border: "1px solid #ddd", borderRadius: "8px",
                      maxHeight: "280px", overflowY: "auto", zIndex: 999,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    }}>
                      {filteredProducts.map((p) => {
                        const isSel = selectedProducts.find((sp) => sp.id === p.id);
                        return (
                          <div key={p.id}
                            onClick={() => { toggleProduct(p); setDropdownOpen(false); setSearchQuery(""); }}
                            style={{
                              padding: "10px 14px", cursor: "pointer",
                              display: "flex", alignItems: "center", gap: "10px",
                              background: isSel ? "#f0f7ff" : "#fff",
                              borderBottom: "1px solid #f0f0f0",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#f6f6f7"}
                            onMouseLeave={(e) => e.currentTarget.style.background = isSel ? "#f0f7ff" : "#fff"}
                          >
                            {p.featuredImage?.url && (
                              <img src={p.featuredImage.url} alt={p.title}
                                style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
                            )}
                            <Text variant="bodySm">{p.title}</Text>
                            {isSel && <span style={{ marginLeft: "auto", color: "#458fff", fontWeight: 600 }}>✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Box>
            </Box>

            {selectedProducts.length > 0 && (
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <Text variant="bodySm" fontWeight="semibold">Selected ({selectedProducts.length}):</Text>
                <Box paddingBlockStart="200">
                  <InlineStack gap="200" wrap>
                    {selectedProducts.map((p) => (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "6px 12px", background: "#111", color: "#fff",
                        borderRadius: "20px", fontSize: "13px",
                      }}>
                        {p.featuredImage?.url && (
                          <img src={p.featuredImage.url} alt={p.title}
                            style={{ width: 20, height: 20, objectFit: "cover", borderRadius: "50%" }} />
                        )}
                        {p.title}
                        <span onClick={() => toggleProduct(p)}
                          style={{ cursor: "pointer", marginLeft: "4px", opacity: 0.7 }}>✕</span>
                      </div>
                    ))}
                  </InlineStack>
                </Box>
              </Box>
            )}
          </BlockStack>
        </Card>

        {/* ── MANUAL QUESTIONS ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">✏️ Manual Questions ({manualQuestions.length})</Text>
              <Button onClick={addManualQuestion} size="slim">➕ Add Question</Button>
            </InlineStack>
            <Text variant="bodySm" tone="subdued">
              Add custom questions — combine with AI or use alone.
            </Text>

            {manualQuestions.length === 0 ? (
              <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                <Text variant="bodySm" tone="subdued" alignment="center">
                  No manual questions yet. Click "Add Question" to create one.
                </Text>
              </Box>
            ) : (
              manualQuestions.map((q, qIndex) => (
                <Box key={qIndex} padding="400" borderWidth="025" borderColor="border" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingSm">Question {qIndex + 1}</Text>
                      <Button tone="critical" size="slim" onClick={() => removeManualQuestion(qIndex)}>
                        🗑️ Remove
                      </Button>
                    </InlineStack>
                    <TextField label="Question Text" value={q.question}
                      onChange={(val) => updateQuestion(qIndex, val)}
                      placeholder="e.g. What occasion are you shopping for?"
                      autoComplete="off" />
                    <Text variant="bodySm" fontWeight="semibold">Answer Options:</Text>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      {q.answers.map((ans, aIndex) => (
                        <TextField key={aIndex} label={`Option ${aIndex + 1}`}
                          value={ans} onChange={(val) => updateAnswer(qIndex, aIndex, val)}
                          placeholder={`Answer ${aIndex + 1}`} autoComplete="off" />
                      ))}
                    </div>
                  </BlockStack>
                </Box>
              ))
            )}
          </BlockStack>
        </Card>

        {/* ── GENERATE BUTTONS ── */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">🚀 Generate Quiz</Text>
            <InlineStack gap="300" wrap>
              <Button variant="primary" size="large" onClick={handleGenerateAI}
                loading={isLoading} disabled={selectedProducts.length === 0}>
                🤖 AI + Manual ({validManual.length} manual + 3 AI)
              </Button>
              <Button size="large" onClick={handleGenerateManual}
                loading={isLoading}
                disabled={selectedProducts.length === 0 || validManual.length === 0}>
                ✏️ Manual Only ({validManual.length} questions)
              </Button>
            </InlineStack>
            {selectedProducts.length === 0 && (
              <Text variant="bodySm" tone="subdued">⚠️ Select at least 1 product first</Text>
            )}
          </BlockStack>
        </Card>

        {/* ── EXISTING QUIZZES WITH EDIT ── */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">📋 Your Quizzes ({quizzes.length})</Text>

            {quizzes.length === 0 ? (
              <EmptyState heading="No quizzes yet" image="">
                <p>Create your first quiz above!</p>
              </EmptyState>
            ) : (
              quizzes.map((quiz) => (
                <QuizEditor key={quiz.id} quiz={quiz} fetcher={fetcher} />
              ))
            )}
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}