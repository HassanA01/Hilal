package game

import "testing"

func TestCalculatePoints(t *testing.T) {
	tests := []struct {
		name      string
		elapsed   float64
		timeLimit int
		wantMin   int
		wantMax   int
	}{
		{"instant answer", 0, 20, 990, 1000},
		{"half time", 10, 20, 490, 510},
		{"at limit", 20, 20, 0, 0},
		{"over limit", 25, 20, 0, 0},
		{"zero time limit", 5, 0, 1000, 1000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculatePoints(tc.elapsed, tc.timeLimit)
			if got < tc.wantMin || got > tc.wantMax {
				t.Errorf("CalculatePoints(%v, %v) = %v, want [%v, %v]",
					tc.elapsed, tc.timeLimit, got, tc.wantMin, tc.wantMax)
			}
		})
	}
}

func TestCalculateOrderingPoints(t *testing.T) {
	tests := []struct {
		name             string
		correctPositions int
		totalItems       int
		elapsed          float64
		timeLimit        int
		wantMin          int
		wantMax          int
	}{
		{"all correct instant", 4, 4, 0, 20, 990, 1000},
		{"half correct instant", 2, 4, 0, 20, 490, 510},
		{"none correct", 0, 4, 0, 20, 0, 0},
		{"all correct half time", 4, 4, 10, 20, 490, 510},
		{"half correct half time", 2, 4, 10, 20, 240, 260},
		{"zero items", 0, 0, 0, 20, 0, 0},
		{"one of three", 1, 3, 0, 20, 330, 340},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateOrderingPoints(tc.correctPositions, tc.totalItems, tc.elapsed, tc.timeLimit)
			if got < tc.wantMin || got > tc.wantMax {
				t.Errorf("CalculateOrderingPoints(%d, %d, %v, %v) = %d, want [%d, %d]",
					tc.correctPositions, tc.totalItems, tc.elapsed, tc.timeLimit, got, tc.wantMin, tc.wantMax)
			}
		})
	}
}

func TestCountCorrectPositions(t *testing.T) {
	tests := []struct {
		name         string
		playerOrder  []string
		correctOrder []string
		want         int
	}{
		{"all correct", []string{"a", "b", "c"}, []string{"a", "b", "c"}, 3},
		{"none correct", []string{"c", "a", "b"}, []string{"a", "b", "c"}, 0},
		{"first correct", []string{"a", "c", "b"}, []string{"a", "b", "c"}, 1},
		{"last correct", []string{"b", "a", "c"}, []string{"a", "b", "c"}, 1},
		{"empty", []string{}, []string{}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CountCorrectPositions(tc.playerOrder, tc.correctOrder)
			if got != tc.want {
				t.Errorf("CountCorrectPositions(%v, %v) = %d, want %d",
					tc.playerOrder, tc.correctOrder, got, tc.want)
			}
		})
	}
}
