package game

import "math"

const (
	BasePoints  = 1000
	MinPoints   = 0
	StreakBonus = 100
)

// CalculatePoints returns points for a correct answer.
// elapsed is seconds taken to answer, timeLimit is the question time limit.
// Faster answers score closer to BasePoints; minimum is MinPoints.
func CalculatePoints(elapsed float64, timeLimit int) int {
	if timeLimit <= 0 {
		return BasePoints
	}
	ratio := math.Max(0, 1.0-(elapsed/float64(timeLimit)))
	points := int(math.Round(float64(BasePoints) * ratio))
	if points < MinPoints {
		return MinPoints
	}
	return points
}

// CalculateOrderingPoints returns partial-credit points for an ordering question.
// correctPositions is the number of items the player placed in the correct position.
// totalItems is the total number of items. The result is scaled by the time-weighted score.
func CalculateOrderingPoints(correctPositions, totalItems int, elapsed float64, timeLimit int) int {
	if totalItems == 0 {
		return 0
	}
	positionRatio := float64(correctPositions) / float64(totalItems)
	timePoints := CalculatePoints(elapsed, timeLimit)
	return int(math.Round(positionRatio * float64(timePoints)))
}

// sameStringSet returns true if a and b contain exactly the same elements (order-independent).
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]int, len(a))
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		m[s]--
		if m[s] < 0 {
			return false
		}
	}
	return true
}

// CountCorrectPositions compares the player's ordering to the correct ordering
// and returns how many items are in the correct position.
func CountCorrectPositions(playerOrder, correctOrder []string) int {
	count := 0
	for i := range playerOrder {
		if i < len(correctOrder) && playerOrder[i] == correctOrder[i] {
			count++
		}
	}
	return count
}
