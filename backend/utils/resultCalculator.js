function gradeFromPercentage(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

function calculateResultData({ marks = [] }) {
  if (!marks || marks.length === 0) {
    return {
      totalMarks: 0,
      maxMarks: 0,
      percentage: 0,
      grade: 'F',
      resultStatus: 'FAIL',
    };
  }

  const totalMarks = marks.reduce((sum, item) => sum + Number(item.marks_obtained || 0), 0);
  const maxMarks = marks.reduce((sum, item) => sum + Number(item.max_marks || 0), 0);
  const percentage = maxMarks > 0 ? (totalMarks / maxMarks) * 100 : 0;

  const hasLowSubject = marks.some((item) => {
    const subjectMax = Number(item.max_marks || 0);
    const subjectMarks = Number(item.marks_obtained || 0);
    if (!subjectMax) return false;
    return (subjectMarks / subjectMax) * 100 < 40;
  });

  return {
    totalMarks: Number(totalMarks.toFixed(2)),
    maxMarks: Number(maxMarks.toFixed(2)),
    percentage: Number(percentage.toFixed(2)),
    grade: gradeFromPercentage(percentage),
    resultStatus: hasLowSubject ? 'FAIL' : 'PASS',
  };
}

module.exports = {
  calculateResultData,
  gradeFromPercentage,
};
