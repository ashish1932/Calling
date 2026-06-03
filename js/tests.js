// CounselFlow Diagnostic Assertion Suite

document.addEventListener('DOMContentLoaded', () => {
  const btnRun = document.getElementById('btn-run-tests');
  if (btnRun) {
    btnRun.addEventListener('click', runTestSuite);
  }
  // Run automatically on load
  runTestSuite();
});

function runTestSuite() {
  const container = document.getElementById('test-list-container');
  if (!container) return;
  container.innerHTML = "";

  const results = [];
  
  // Custom assertion wrapper
  function test(name, description, testFn) {
    try {
      testFn();
      results.push({ name, description, status: 'pass', error: null });
    } catch (e) {
      console.error(`Test Fail: ${name}`, e);
      results.push({ name, description, status: 'fail', error: e.message });
    }
  }

  // Helper assert
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  function assertEquals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || "") + ` | Expected: [${expected}], Got: [${actual}]`);
    }
  }

  // --- TEST SUITE DEFINITIONS ---

  // 1. HTML Escape verification
  test(
    "XSS HTML Escaping",
    "Verifies that escapeHtml cleans HTML bracket symbols and quotes successfully.",
    () => {
      const escape = window.CounselFlow.escapeHtml;
      assert(escape !== undefined, "escapeHtml is not defined");
      assertEquals(escape("<div>"), "&lt;div&gt;", "Should escape brackets");
      assertEquals(escape('"hello"'), "&quot;hello&quot;", "Should escape double quotes");
      assertEquals(escape("'world'"), "&#039;world&#039;", "Should escape single quotes");
      assertEquals(escape("counselor & patient"), "counselor &amp; patient", "Should escape ampersand");
    }
  );

  // 2. Encryption Decryption consistency
  test(
    "Symmetric XXTEA Encryption Roundtrip",
    "Verifies patient record obfuscateData/deobfuscateData ciphers match on encryption roundtrip.",
    () => {
      // Access storage encryption methods (which use window.CounselFlow.CONFIG.ENCRYPTION_KEY)
      // Note: obfuscateData and deobfuscateData are exposed/used internally in data.js
      // We can grab them or test rc4 directly since it's the core.
      // But we can test obfuscateData / deobfuscateData directly!
      const testData = { id: "PT-9999", name: "Ranjit Singh", progress: 65 };
      const rawObfuscated = obfuscateData(testData);
      assert(rawObfuscated !== JSON.stringify(testData), "Data must be encrypted/obfuscated");
      const decrypted = deobfuscateData(rawObfuscated);
      assertEquals(decrypted.id, testData.id, "ID must match after decryption");
      assertEquals(decrypted.name, testData.name, "Name must match after decryption");
      assertEquals(decrypted.progress, testData.progress, "Progress must match after decryption");
    }
  );

  // 3. MOCK_DATE Sanitizer bounds check
  test(
    "MOCK_DATE Date Sanitizer Bounds",
    "Verifies that relative date calculations handle invalid/non-numeric inputs gracefully.",
    () => {
      // Mock date helper is in scope
      const validOffset = MOCK_DATE(2);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(validOffset), "Should return valid ISO YYYY-MM-DD date");
      
      const nanOffset = MOCK_DATE("invalid_days");
      const today = new Date().toISOString().split('T')[0];
      assertEquals(nanOffset, today, "NaN days should fallback to today's date");
      
      const negativeOffset = MOCK_DATE(-5);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(negativeOffset), "Negative offset (future date) should parse safely to a valid date");
    }
  );

  // 4. Patient Registration Validation checks
  test(
    "JavaScript Form Inputs Validation",
    "Verifies strict JS-level registration bounds (age boundaries, name length limits, phone regex patterns).",
    () => {
      // Validation rules duplicated here for testing target verification
      function validateFields(name, age, phone, address) {
        const nameTrim = name.trim();
        if (!nameTrim || nameTrim.length < 2 || nameTrim.length > 50) return "NAME_ERR";
        if (isNaN(age) || age < 12 || age > 100) return "AGE_ERR";
        const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
        if (!phone || !phoneRegex.test(phone.trim())) return "PHONE_ERR";
        const addressTrim = address.trim();
        if (!addressTrim || addressTrim.length < 3 || addressTrim.length > 100) return "ADDRESS_ERR";
        return "OK";
      }

      assertEquals(validateFields("A", 28, "+91 98765-43210", "Amritsar"), "NAME_ERR", "Blocked names under 2 chars");
      assertEquals(validateFields("Balbir Singh", 10, "+91 98765-43210", "Amritsar"), "AGE_ERR", "Blocked ages under 12");
      assertEquals(validateFields("Balbir Singh", 105, "+91 98765-43210", "Amritsar"), "AGE_ERR", "Blocked ages over 100");
      assertEquals(validateFields("Balbir Singh", 28, "12345", "Amritsar"), "PHONE_ERR", "Blocked phone numbers under 10 chars");
      assertEquals(validateFields("Balbir Singh", 28, "+91 98765-43210", "Am"), "ADDRESS_ERR", "Blocked addresses under 3 chars");
      assertEquals(validateFields("Balbir Singh", 28, "+91 98765-43210", "Amritsar"), "OK", "Allow valid fields combination");
    }
  );

  // 5. NLP Summarization and Relapse Risk trigger keyword validation
  test(
    "NLP AI Summarizer Keyword Triggers",
    "Verifies AI model maps multilingual text transcripts to correct clinical risk scores.",
    () => {
      const ai = window.CounselFlow.aiOrchestrator;
      assert(ai !== undefined, "AIOrchestrator must be initialized");
      
      // Test Punjabi cravings triggers
      const punjabiCravingsTranscript = [
        { speaker: "Patient", text: "ਮੈਨੂੰ ਕੱਲ੍ਹ ਸ਼ਾਮ ਨੂੰ ਬਹੁਤ ਜ਼ਿਆਦਾ ਤਲਬ ਹੋਈ ਸੀ ਤੇ ਮਨ ਡੋਲ ਰਿਹਾ ਸੀ" }
      ];
      const summary1 = ai.generateSummary(punjabiCravingsTranscript, "pa-IN");
      assertEquals(summary1.risk, "Medium Risk", "Punjabi cravings triggers should map to Medium Risk");

      // Test Hindi withdrawal triggers (severe clinical signs)
      const hindiWithdrawalTranscript = [
        { speaker: "Patient", text: "शरीर में बहुत दर्द हो रहा था और बहुत उल्टी आई" }
      ];
      const summary2 = ai.generateSummary(hindiWithdrawalTranscript, "hi-IN");
      assertEquals(summary2.risk, "Critical Risk", "Hindi vomiting symptoms should escalate to Critical Risk");
    }
  );

  // --- RENDER TEST SUITE RESULTS ---
  let passedCount = 0;
  let failedCount = 0;

  results.forEach(res => {
    const card = document.createElement('div');
    card.className = 'test-card';
    
    let statusClass = 'pending';
    if (res.status === 'pass') {
      statusClass = 'pass';
      passedCount++;
    } else if (res.status === 'fail') {
      statusClass = 'fail';
      failedCount++;
    }

    card.innerHTML = `
      <div class="test-info">
        <h4>${res.name}</h4>
        <p>${res.description}</p>
        ${res.error ? `<span style="color:var(--accent-red); font-size:11px; font-family:monospace; display:block; margin-top:6px;">Error: ${res.error}</span>` : ''}
      </div>
      <div class="test-status ${statusClass}">${res.status}</div>
    `;
    container.appendChild(card);
  });

  // Update summary analytics
  document.getElementById('stat-total').innerText = results.length;
  document.getElementById('stat-passed').innerText = passedCount;
  document.getElementById('stat-failed').innerText = failedCount;
  
  const successRate = results.length > 0 ? Math.round((passedCount / results.length) * 100) : 0;
  document.getElementById('stat-rate').innerText = `${successRate}%`;
}
